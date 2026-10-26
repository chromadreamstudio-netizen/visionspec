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
  Grid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GoogleGenAI } from "@google/genai";

// 1. Loader: Fetch Products
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

// 2. Action: Generation and Injection
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "generate") {
    const productId = formData.get("selectedProduct") as string;
    const language = formData.get("language") as string;
    
    // Fact-based inputs
    const length = formData.get("length") as string;
    const width = formData.get("width") as string;
    const height = formData.get("height") as string;
    const unit = formData.get("unit") as string;
    const isEco = formData.get("isEco") as string;
    const hasWarranty = formData.get("hasWarranty") as string;
    const warrantyPeriod = formData.get("warrantyPeriod") as string;
    const requiresSafety = formData.get("requiresSafety") as string;
    const keywords = formData.get("keywords") as string;

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
      const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash"; 
      
      const systemPrompt = `You are a world-class e-commerce copywriter and technical data analyst.
      Analyze the provided product title, current description, image (if available), and STRICT FACTUAL DATA provided by the merchant.
      
      Your goal is to generate a complete, high-converting product listing in pure HTML.
      
      CRITICAL INSTRUCTIONS:
      1. MUST Output the entire response in ${language}.
      2. DO NOT invent or hallucinate dimensions, warranties, or safety notices. ONLY use the 'Merchant Provided Facts' below.
      3. If a material or feature is clearly visible in the image, you may include it.
      
      OUTPUT FORMAT (Generate ONLY HTML, no markdown wrapping, no \`\`\`html):
      
      <div class="visionspec-listing">
        <h2 style="font-size: 1.5em; font-weight: bold; margin-bottom: 15px;">[SEO Optimized, Catchy Product Title - based on image and facts]</h2>
        
        <div style="margin-bottom: 25px; line-height: 1.6;">
          <p>[Sales Paragraph 1: Focus on the emotional benefit, luxury, or problem solved, utilizing keywords if provided.]</p>
          <p>[Sales Paragraph 2: Focus on the quality, materials visible in the image, and practical use.]</p>
        </div>
        
        <h3 style="font-size: 1.2em; font-weight: bold; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Technical Specifications</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
           <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
             <th style="padding: 12px; text-align: left; font-weight: 600; width: 40%;">Specification</th>
             <th style="padding: 12px; text-align: left; font-weight: 600;">Details</th>
           </tr>
           [Generate table rows based ONLY on provided facts and visible image features. DO NOT invent warranties.]
        </table>
        
        [IF Merchant specified Safety Notice = YES, include this exact block, otherwise OMIT IT COMPLETELY]:
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-top: 20px; border-radius: 4px;">
           <strong style="color: #b91c1c; display: block; margin-bottom: 5px;">⚠️ Safety & Compliance Notice</strong>
           <p style="margin: 0; color: #7f1d1d; font-size: 0.9em;">Complies with General Product Safety Regulation (EU) 2023/988 consumer standards. Please inspect periodically for wear or loose parts.</p>
        </div>
      </div>`;

      // Construct Fact String
      let facts = `MERCHANT PROVIDED FACTS (USE THESE EXACTLY, DO NOT INVENT):
`;
      if (length || width || height) facts += `- Dimensions: ${length || '?'} x ${width || '?'} x ${height || '?'} ${unit}
`;
      if (isEco === 'yes') facts += `- Environment: Eco-Friendly / Sustainable Materials
`;
      if (hasWarranty === 'yes' && warrantyPeriod) facts += `- Warranty: ${warrantyPeriod}
`;
      if (hasWarranty === 'no') facts += `- Warranty: No Warranty
`;
      if (keywords) facts += `- Focus Keywords: ${keywords}
`;

      let textPart = `Original Product Title: ${product.title}

${facts}`;
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
            { text: systemPrompt + "

" + textPart },
            { inlineData: { data: base64Image, mimeType } }
          ]
        }];
      } else {
        contents = [{ role: 'user', parts: [{ text: systemPrompt + "

" + textPart }] }];
      }

      const response = await generateWithRetry(ai, modelName, contents);
      let rawHtml = response.text || "";
      rawHtml = rawHtml.replace(/```html/g, "").replace(/```/g, "").trim();

      return Response.json({ 
        actionType: "generate",
        success: true, 
        generatedContent: rawHtml,
        selectedProduct: productId 
      });
    } catch (error: any) {
      return Response.json({ error: `AI Error: ${error.message || "Failed to analyze product."}` });
    }
  }

  if (actionType === "inject") {
    const productId = formData.get("productId") as string;
    const htmlContent = formData.get("htmlContent") as string;

    if (!productId || !htmlContent) {
      return Response.json({ error: "Missing product ID or HTML content." });
    }

    try {
      // Overwrite the description completely with the new smart listing
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
            descriptionHtml: htmlContent 
          } 
        } 
      });

      const updateData = await updateRes.json();
      const userErrors = updateData?.data?.productUpdate?.userErrors;
      
      if (userErrors && userErrors.length > 0) {
        const errorMsg = userErrors.map((e: any) => e.message).join(", ");
        return Response.json({ error: `Shopify API Error: ${errorMsg}` });
      }

      return Response.json({ actionType: "inject", success: true, message: "Smart Listing injected magically! ✨" });
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
    { label: '--- Select a product ---', value: '' },
    ...(products || []).map((edge: any) => ({
      label: edge.node.title,
      value: edge.node.id,
    }))
  ];

  const languageOptions = [
    { label: 'English', value: 'English' },
    { label: 'العربية (Arabic)', value: 'Arabic' },
    { label: 'Türkçe (Turkish)', value: 'Turkish' },
    { label: 'Français (French)', value: 'French' },
  ];

  const [selectedProduct, setSelectedProduct] = useState("");
  const [language, setLanguage] = useState("English");
  
  // Fact-based states
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [unit, setUnit] = useState("cm");
  const [isEco, setIsEco] = useState("no");
  const [hasWarranty, setHasWarranty] = useState("no");
  const [warrantyPeriod, setWarrantyPeriod] = useState("");
  const [requiresSafety, setRequiresSafety] = useState("no");
  const [keywords, setKeywords] = useState("");

  const isGenerating = nav.state === "submitting" && nav.formData?.get("_action") === "generate";
  const isInjecting = nav.state === "submitting" && nav.formData?.get("_action") === "inject";

  useEffect(() => {
    if (actionData?.actionType === "inject" && actionData.success) {
      if (typeof shopify !== 'undefined') shopify.toast.show("Listing updated successfully!");
    }
  }, [actionData]);

  return (
    <Page title="VisionSpec Pro AI" subtitle="Smart Listing Generator">
      <BlockStack gap="500">
        <Layout>
          
          {actionData?.actionType === "inject" && actionData.success && (
            <Layout.Section>
              <Banner tone="success">
                {actionData.message} Check your Shopify product page.
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
            <Form method="post">
              <input type="hidden" name="_action" value="generate" />
              
              <Grid>
                {/* Left Column: Essential Setup */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">1. Basic Setup</Text>
                      
                      <Select
                        label="Target Product"
                        name="selectedProduct"
                        options={productOptions}
                        onChange={setSelectedProduct}
                        value={selectedProduct}
                        helpText="Select the product to analyze."
                      />
                      
                      <Select
                        label="Output Language"
                        name="language"
                        options={languageOptions}
                        onChange={setLanguage}
                        value={language}
                      />

                      <TextField
                        label="Focus Keywords (Optional)"
                        name="keywords"
                        value={keywords}
                        onChange={setKeywords}
                        autoComplete="off"
                        placeholder="e.g. premium, durable, orthopedic"
                        helpText="Keywords the AI will naturally weave into the sales copy."
                      />
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* Right Column: Ground Truth Facts */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">2. Ground Truth Facts</Text>
                      <Text as="p" tone="subdued">Provide hard facts to prevent AI hallucinations.</Text>
                      
                      <InlineStack gap="300" wrap={false}>
                        <div style={{flex: 1}}><TextField label="Length" name="length" type="number" value={length} onChange={setLength} autoComplete="off" /></div>
                        <div style={{flex: 1}}><TextField label="Width" name="width" type="number" value={width} onChange={setWidth} autoComplete="off" /></div>
                        <div style={{flex: 1}}><TextField label="Height" name="height" type="number" value={height} onChange={setHeight} autoComplete="off" /></div>
                        <div style={{flex: 1}}>
                          <Select label="Unit" name="unit" options={[{label:'cm', value:'cm'}, {label:'inch', value:'inch'}]} value={unit} onChange={setUnit} />
                        </div>
                      </InlineStack>

                      <Divider />

                      <InlineStack gap="400">
                        <Select
                          label="Eco-Friendly?"
                          name="isEco"
                          options={[{label: 'No', value: 'no'}, {label: 'Yes', value: 'yes'}]}
                          value={isEco}
                          onChange={setIsEco}
                        />
                        <Select
                          label="EU Safety Notice?"
                          name="requiresSafety"
                          options={[{label: 'No', value: 'no'}, {label: 'Yes (Add Warning)', value: 'yes'}]}
                          value={requiresSafety}
                          onChange={setRequiresSafety}
                          helpText="Adds compliant GPSR alert box."
                        />
                      </InlineStack>

                      <InlineStack gap="400" blockAlign="end">
                        <Select
                          label="Warranty Available?"
                          name="hasWarranty"
                          options={[{label: 'No', value: 'no'}, {label: 'Yes', value: 'yes'}]}
                          value={hasWarranty}
                          onChange={setHasWarranty}
                        />
                        {hasWarranty === 'yes' && (
                          <div style={{flex: 1}}>
                            <TextField
                              label="Warranty Period"
                              name="warrantyPeriod"
                              value={warrantyPeriod}
                              onChange={setWarrantyPeriod}
                              autoComplete="off"
                              placeholder="e.g. 12 Months"
                            />
                          </div>
                        )}
                      </InlineStack>
                      
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>

              <div style={{ marginTop: '20px' }}>
                <Card>
                  <BlockStack align="center" inlineAlign="center">
                    <Button submit variant="primary" size="large" loading={isGenerating} disabled={!selectedProduct}>
                      Generate Smart Listing ✨
                    </Button>
                  </BlockStack>
                </Card>
              </div>
            </Form>
          </Layout.Section>

          {/* Output Preview Section (No raw HTML) */}
          {actionData?.actionType === "generate" && actionData.success && actionData.generatedContent && (
            <Layout.Section>
              <Card>
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Visual Preview</Text>
                    
                    <Form method="post">
                      <input type="hidden" name="_action" value="inject" />
                      <input type="hidden" name="productId" value={actionData.selectedProduct} />
                      <input type="hidden" name="htmlContent" value={actionData.generatedContent} />
                      <Button submit variant="primary" loading={isInjecting}>
                        Inject into Product Page
                      </Button>
                    </Form>
                  </InlineStack>
                  
                  <Divider />
                  
                  <div 
                    style={{ padding: '20px', backgroundColor: '#fff', border: '1px solid #dfe3e8', borderRadius: '8px' }}
                    dangerouslySetInnerHTML={{ __html: actionData.generatedContent }} 
                  />
                  
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}