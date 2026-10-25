import { useState, useCallback, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useNavigation, Form, useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  TextField,
  InlineStack,
  Divider,
  Banner,
  Select,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GoogleGenAI } from "@google/genai";

// 1. Loader: جلب المنتجات 
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const response = await admin.graphql(
      `query {
        products(first: 20, reverse: true) {
          edges {
            node {
              id
              title
              images(first: 1) {
                edges {
                  node { url }
                }
              }
            }
          }
        }
      }`
    );
    const parsedData = await response.json();
    return Response.json({ products: parsedData?.data?.products?.edges || [] });
  } catch (error) {
    return Response.json({ products: [] });
  }
};

async function generateWithRetry(ai: GoogleGenAI, modelName: string, contents: any, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({ model: modelName, contents });
    } catch (error: any) {
      if ((error.status === 503 || error.code === 503 || JSON.stringify(error).includes("503")) && i < retries - 1) {
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      throw error;
    }
  }
}

// 2. Action: التوليد والحقن
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "generate") {
    const productId = formData.get("selectedProduct") as string;
    const language = formData.get("language") as string;
    const extraNotes = formData.get("extraNotes") as string;

    if (!productId) return Response.json({ error: "Please select a product first." });

    try {
      const productRes = await admin.graphql(
        `query getProduct($id: ID!) {
          product(id: $id) {
            title
            descriptionHtml
            images(first: 1) { edges { node { url } } }
          }
        }`,
        { variables: { id: productId } }
      );
      
      const productData = await productRes.json();
      const product = productData?.data?.product;
      if (!product) return Response.json({ error: "Product not found." });

      const imageUrl = product.images?.edges[0]?.node?.url;

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash"; 
      
      const systemPrompt = `You are an expert e-commerce data entry specialist. 
      Analyze the provided product title, description, and IMAGE (if available) to discover its specifications (materials, dimensions, colors, features).
      Format them into a clean HTML table with two columns: 'Feature / Specification' and 'Details'.
      Use elegant inline CSS. Output ONLY the raw HTML table without markdown tags.
      CRITICAL: Write the table content entirely in ${language}.`;

      let textPart = `Product Title: ${product.title}\nCurrent Description: ${product.descriptionHtml || "None"}\nAdditional Notes from Merchant: ${extraNotes || "None"}`;
      let contents: any[] = [];
      
      if (imageUrl) {
        const imgFetch = await fetch(imageUrl);
        const arrayBuffer = await imgFetch.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString("base64");
        const mimeType = imgFetch.headers.get("content-type") || "image/jpeg";

        contents = [{
          role: 'user',
          parts: [
            { text: systemPrompt + "\n\n" + textPart },
            { inlineData: { data: base64Image, mimeType } }
          ]
        }];
      } else {
        contents = [{ role: 'user', parts: [{ text: systemPrompt + "\n\n" + textPart }] }];
      }

      const response = await generateWithRetry(ai, modelName, contents);
      let rawHtml = response.text || "";
      rawHtml = rawHtml.replace(/```html/g, "").replace(/```/g, "").trim();

      return Response.json({ 
        actionType: "generate",
        success: true, 
        generatedTable: rawHtml,
        selectedProduct: productId 
      });
    } catch (error: any) {
      return Response.json({ error: `AI Error: ${error.message || "Failed to analyze product."}` });
    }
  }

  if (actionType === "inject") {
    const productId = formData.get("productId") as string;
    const htmlTable = formData.get("htmlTable") as string;

    if (!productId || !htmlTable) {
      return Response.json({ error: "Missing product ID or HTML table." });
    }

    try {
      const getProductQuery = `query getProduct($id: ID!) { product(id: $id) { descriptionHtml } }`;
      const productResponse = await admin.graphql(getProductQuery, { variables: { id: productId } });
      const productData = await productResponse.json();
      const currentHtml = productData?.data?.product?.descriptionHtml || "";

      const updatedHtml = `${currentHtml}<br><br>${htmlTable}`;

      const updateMutation = `
        mutation productUpdate($input: ProductInput!) { 
          productUpdate(input: $input) { 
            product { id } 
            userErrors { field message } 
          } 
        }`;
      
      const updateRes = await admin.graphql(updateMutation, { 
        variables: { 
          input: { 
            id: productId, 
            descriptionHtml: updatedHtml 
          } 
        } 
      });

      const updateData = await updateRes.json();
      const userErrors = updateData?.data?.productUpdate?.userErrors;
      
      if (userErrors && userErrors.length > 0) {
        const errorMsg = userErrors.map((e: any) => e.message).join(", ");
        return Response.json({ error: `Shopify API Error: ${errorMsg}` });
      }

      return Response.json({ actionType: "inject", success: true, message: "Table injected magically! ✨" });
    } catch (error: any) {
      const gqlErrors = error?.graphQLErrors || error?.body?.errors;
      const details = gqlErrors ? JSON.stringify(gqlErrors) : (error.message || error);
      return Response.json({ error: `Injection failed: ${details}` });
    }
  }

  return Response.json({ error: "Invalid action." });
};

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  
  const productOptions = [
    { label: '--- Select a product to analyze ---', value: '' },
    ...(products || []).map((edge: any) => ({
      label: edge.node.title,
      value: edge.node.id,
    }))
  ];

  const languageOptions = [
    { label: 'English', value: 'English' },
    { label: 'العربية (Arabic)', value: 'Arabic' },
    { label: 'Türkçe (Turkish)', value: 'Turkish' },
  ];

  const [selectedProduct, setSelectedProduct] = useState("");
  const [language, setLanguage] = useState("English");
  const [extraNotes, setExtraNotes] = useState("");

  const isGenerating = nav.state === "submitting" && nav.formData?.get("_action") === "generate";
  const isInjecting = nav.state === "submitting" && nav.formData?.get("_action") === "inject";

  useEffect(() => {
    if (actionData?.actionType === "inject" && actionData.success) {
      if (typeof shopify !== 'undefined') shopify.toast.show("Specs saved to product successfully!");
      setExtraNotes("");
    }
  }, [actionData]);

  const handleCopy = useCallback(() => {
    if (actionData?.generatedTable) {
      navigator.clipboard.writeText(actionData.generatedTable);
      if (typeof shopify !== 'undefined') shopify.toast.show("HTML Code copied!");
    }
  }, [actionData]);

  return (
    <Page title="VisionSpec Pro AI - Auto Discover Specs">
      <BlockStack gap="500">
        <Layout>
          
          {actionData?.actionType === "inject" && actionData.success && (
            <Layout.Section>
              <Banner tone="success">
                {actionData.message} Check your Shopify product page to see the magic.
              </Banner>
            </Layout.Section>
          )}

          {actionData?.error && (
            <Layout.Section>
              <Banner tone="critical">
                {actionData.error}
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Step 1: AI Vision Analysis</Text>
                <Text as="p" tone="subdued">
                  Just select a product. Our AI will look at the product's image and current description to figure out the specs automatically!
                </Text>

                <Form method="post">
                  <input type="hidden" name="_action" value="generate" />
                  <BlockStack gap="400">
                    <Select
                      label="1. Target Product (Required)"
                      name="selectedProduct"
                      options={productOptions}
                      onChange={setSelectedProduct}
                      value={selectedProduct}
                    />
                    
                    <Select
                      label="2. Output Language"
                      name="language"
                      options={languageOptions}
                      onChange={setLanguage}
                      value={language}
                    />

                    <TextField
                      label="3. Extra Notes (Optional)"
                      name="extraNotes"
                      value={extraNotes}
                      onChange={setExtraNotes}
                      autoComplete="off"
                      multiline={2}
                      placeholder="e.g. Highlight that the material is eco-friendly..."
                      helpText="Leave empty to let the AI do all the work."
                    />
                    
                    <InlineStack align="end">
                      <Button submit variant="primary" loading={isGenerating} disabled={!selectedProduct}>
                        Auto-Analyze & Build Table
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          {actionData?.actionType === "generate" && actionData.success && actionData.generatedTable && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Generated Specification Table</Text>
                    
                    <Form method="post">
                      <input type="hidden" name="_action" value="inject" />
                      <input type="hidden" name="productId" value={actionData.selectedProduct} />
                      <input type="hidden" name="htmlTable" value={actionData.generatedTable} />
                      <Button submit variant="primary" loading={isInjecting}>
                        Inject into Product Page
                      </Button>
                    </Form>
                  </InlineStack>
                  
                  <Divider />
                  <div dangerouslySetInnerHTML={{ __html: actionData.generatedTable }} style={{ overflowX: 'auto', padding: '10px', border: '1px solid #dfe3e8', borderRadius: '8px' }} />
                  <Divider />
                  
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Manual HTML Code:</Text>
                    <Button onClick={handleCopy}>Copy HTML Code</Button>
                  </InlineStack>
                  <TextField labelHidden label="HTML Code" value={actionData.generatedTable} multiline={4} autoComplete="off" readOnly />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}