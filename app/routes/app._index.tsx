import { useState, useEffect } from "react";
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
  Badge,
  Checkbox,
  ButtonGroup,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GoogleGenAI } from "@google/genai";

// 1. Loader: سحب المنتجات
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const response = await admin.graphql(
      `query {
        products(first: 30, reverse: true) {
          edges {
            node {
              id
              title
              vendor
              productType
              images(first: 1) {
                edges {
                  node { url }
                }
              }
              variants(first: 15) {
                edges {
                  node {
                    sku
                    title
                    price
                  }
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

// 2. Action: التوليد والحقن (تحسين منتج أو إنشاء منتج جديد من الصفر)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "generate") {
    const mode = formData.get("mode") as string; // "enhance" or "create"
    const productId = formData.get("selectedProduct") as string;
    const language = formData.get("language") as string;
    const category = formData.get("category") as string;
    
    // New Product Fields if mode === "create"
    const newTitleInput = formData.get("newTitleInput") as string;
    const newImageUrl = formData.get("newImageUrl") as string;

    // Ground Truth Inputs
    const rawSpecs = formData.get("rawSpecs") as string;
    const length = formData.get("length") as string;
    const width = formData.get("width") as string;
    const height = formData.get("height") as string;
    const unit = formData.get("unit") as string;
    const isEco = formData.get("isEco") as string;
    const hasWarranty = formData.get("hasWarranty") as string;
    const warrantyPeriod = formData.get("warrantyPeriod") as string;
    const requiresSafety = formData.get("requiresSafety") as string;
    const keywords = formData.get("keywords") as string;

    if (mode === "enhance" && !productId) return Response.json({ error: "Please select an existing product first." });
    if (mode === "create" && !newTitleInput) return Response.json({ error: "Please enter a product title for the new product." });

    try {
      let baseTitle = newTitleInput;
      let imageUrl = newImageUrl;
      let productContext = "";

      if (mode === "enhance") {
        const productRes = await admin.graphql(
          `query getProduct($id: ID!) {
            product(id: $id) {
              title
              vendor
              descriptionHtml
              images(first: 1) { edges { node { url } } }
              variants(first: 15) {
                edges {
                  node { sku title price }
                }
              }
            }
          }`,
          { variables: { id: productId } }
        );
        const productData = await productRes.json();
        const product = productData?.data?.product;
        if (!product) return Response.json({ error: "Product not found." });

        baseTitle = product.title;
        imageUrl = product.images?.edges[0]?.node?.url;
        productContext = `Vendor: ${product.vendor || 'N/A'}\nOriginal Description: ${product.descriptionHtml || 'None'}`;
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash"; 
      
      const systemPrompt = `You are an elite E-Commerce Conversion Copywriter, Technical Engineer, and SEO Specialist.
Analyze the provided product title, image (if available), and STRICT GROUND-TRUTH FACTS.

CRITICAL RULES:
1. Write all output entirely in ${language}.
2. ZERO HALLUCINATION POLICY: Never invent dimensions, sub-component measurements, or warranties. Use ONLY the merchant's facts and raw factory specs.
3. Parse any "Raw Factory Specs" into separate, crystal-clear rows inside the Technical Specifications table.
4. Industry Context: Tailor the tone for "${category}".

Return your response as a valid JSON object ONLY (no markdown formatting, no \`\`\`json) with this exact structure:
{
  "seoTitle": "High-converting, SEO-optimized Product Title",
  "metaTitle": "Google Search SEO Title (Max 60 characters)",
  "metaDescription": "Compelling Google Search Meta Description (Max 155 characters)",
  "htmlContent": "Complete HTML for product description following the exact template below"
}

HTML TEMPLATE FOR "htmlContent":
<div class="visionspec-smart-listing" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; line-height: 1.6;">
  <h2 style="font-size: 1.4em; font-weight: 700; color: #111827; margin-bottom: 12px;">[Insert Catchy Headline]</h2>
  <p style="margin-bottom: 16px; font-size: 1.05em; color: #374151;">[Engaging opening paragraph highlighting primary benefits and durability]</p>
  
  <h3 style="font-size: 1.15em; font-weight: 600; color: #111827; margin-top: 24px; margin-bottom: 12px;">✨ Key Highlights & Features</h3>
  <ul style="margin-bottom: 24px; padding-left: 20px; color: #374151;">
    <li style="margin-bottom: 8px;"><strong>[Feature 1]:</strong> [Explanation]</li>
    <li style="margin-bottom: 8px;"><strong>[Feature 2]:</strong> [Explanation]</li>
  </ul>

  <h3 style="font-size: 1.15em; font-weight: 600; color: #111827; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">📐 Technical Specifications & Dimensions</h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 0.95em; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
    <thead>
      <tr style="background-color: #111827; color: #ffffff; text-align: left;">
        <th style="padding: 12px 16px; width: 40%;">Specification / Component</th>
        <th style="padding: 12px 16px;">Details</th>
      </tr>
    </thead>
    <tbody>
      [Generate alternating table rows with padding: 12px 16px; border-bottom: 1px solid #e5e7eb;]
    </tbody>
  </table>

  [IF Safety Notice is YES, include this exact block, otherwise OMIT]:
  <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin-top: 24px; border-radius: 6px;">
    <strong style="color: #991b1b; display: block; margin-bottom: 4px; font-size: 0.95em;">🛡️ EU GPSR & Product Safety Compliance</strong>
    <p style="margin: 0; color: #7f1d1d; font-size: 0.9em;">Keep away from open flames. Inspect periodically for wear or loose parts. Complies with General Product Safety Regulation (EU) 2023/988 consumer standards.</p>
  </div>
</div>`;

      let facts = `MERCHANT GROUND-TRUTH FACTS:\n`;
      if (rawSpecs) facts += `- Raw Factory Specs: \n${rawSpecs}\n`;
      if (length || width || height) facts += `- Overall Dimensions: ${length || '-'} x ${width || '-'} x ${height || '-'} ${unit}\n`;
      if (isEco === 'yes') facts += `- Sustainability: Eco-Friendly & Non-Toxic Materials\n`;
      if (hasWarranty === 'yes' && warrantyPeriod) facts += `- Warranty: ${warrantyPeriod}\n`;
      if (hasWarranty === 'no') facts += `- Warranty: None\n`;
      facts += `- Include EU Safety Notice Block: ${requiresSafety === 'yes' ? 'YES' : 'NO'}\n`;
      if (keywords) facts += `- Target SEO Keywords: ${keywords}\n`;

      const textPart = `Product Title: ${baseTitle}\n${productContext}\n\n${facts}`;
      let contents: any[] = [];
      
      if (imageUrl) {
        try {
          const imgFetch = await fetch(imageUrl);
          const arrayBuffer = await imgFetch.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64Image = buffer.toString("base64");
          const mimeType = imgFetch.headers.get("content-type") || "image/jpeg";

          contents = [{
            role: 'user',
            parts: [
              { text: `${systemPrompt}\n\n${textPart}` },
              { inlineData: { data: base64Image, mimeType } }
            ]
          }];
        } catch (e) {
          contents = [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${textPart}` }] }];
        }
      } else {
        contents = [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${textPart}` }] }];
      }

      const response = await generateWithRetry(ai, modelName, contents);
      let rawText = response.text || "";
      rawText = rawText.replace(/```json/g, "").replace(/```html/g, "").replace(/```/g, "").trim();

      let parsedResult;
      try {
        parsedResult = JSON.parse(rawText);
      } catch (e) {
        parsedResult = {
          seoTitle: baseTitle,
          metaTitle: baseTitle.slice(0, 60),
          metaDescription: "High quality product verified by VisionSpec Pro AI.",
          htmlContent: rawText,
        };
      }

      return Response.json({ 
        actionType: "generate",
        success: true, 
        mode,
        generatedContent: parsedResult.htmlContent,
        seoTitle: parsedResult.seoTitle,
        metaTitle: parsedResult.metaTitle,
        metaDescription: parsedResult.metaDescription,
        selectedProduct: productId,
        newTitleInput: baseTitle,
        newImageUrl: imageUrl || "",
      });
    } catch (error: any) {
      return Response.json({ error: `AI Error: ${error.message || "Failed to analyze product."}` });
    }
  }

  if (actionType === "inject") {
    const mode = formData.get("mode") as string;
    const productId = formData.get("productId") as string;
    const htmlContent = formData.get("htmlContent") as string;
    const seoTitle = formData.get("seoTitle") as string;
    const metaTitle = formData.get("metaTitle") as string;
    const metaDescription = formData.get("metaDescription") as string;
    const newPrice = formData.get("newPrice") as string;
    const newSku = formData.get("newSku") as string;
    const newImageUrl = formData.get("newImageUrl") as string;

    if (!htmlContent) return Response.json({ error: "Missing content." });

    try {
      if (mode === "create") {
        // Create brand new product in Shopify!
        const createMutation = `
          mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
            productCreate(input: $input, media: $media) {
              product { id title }
              userErrors { field message }
            }
          }`;

        const productInput: any = {
          title: seoTitle,
          descriptionHtml: htmlContent,
          variants: [{ price: newPrice || "29.99", sku: newSku || "SKU-PRO" }],
          seo: { title: metaTitle, description: metaDescription }
        };

        const mediaInput = newImageUrl ? [{ originalSource: newImageUrl, mediaContentType: "IMAGE" }] : [];

        const createRes = await admin.graphql(createMutation, {
          variables: { input: productInput, media: mediaInput }
        });

        const createData = await createRes.json();
        const userErrors = createData?.data?.productCreate?.userErrors;

        if (userErrors && userErrors.length > 0) {
          return Response.json({ error: `Shopify Create Error: ${userErrors.map((e:any)=>e.message).join(", ")}` });
        }

        return Response.json({ 
          actionType: "inject", 
          success: true, 
          message: "New Product Created & Published to Shopify with Full Smart Listing & SEO! 🎉" 
        });

      } else {
        // Enhance existing product
        const productInput: any = {
          id: productId,
          descriptionHtml: htmlContent,
          title: seoTitle,
          seo: { title: metaTitle, description: metaDescription },
        };

        const updateMutation = `
          mutation productUpdate($input: ProductInput!) { 
            productUpdate(input: $input) { 
              product { id } 
              userErrors { field message } 
            } 
          }`;
        
        const updateRes = await admin.graphql(updateMutation, { variables: { input: productInput } });
        const updateData = await updateRes.json();
        const userErrors = updateData?.data?.productUpdate?.userErrors;
        
        if (userErrors && userErrors.length > 0) {
          return Response.json({ error: `Shopify API Error: ${userErrors.map((e:any)=>e.message).join(", ")}` });
        }

        return Response.json({ actionType: "inject", success: true, message: "Existing Product Updated Successfully! 🚀" });
      }
    } catch (error: any) {
      return Response.json({ error: `Operation failed: ${error.message || error}` });
    }
  }

  return Response.json({ error: "Invalid action." });
};

export default function Index() {
  const { products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  
  const productOptions = [
    { label: '--- Select existing product ---', value: '' },
    ...(products || []).map((edge: any) => ({
      label: edge.node.title,
      value: edge.node.id,
    }))
  ];

  const languageOptions = [
    { label: 'English', value: 'English' },
    { label: 'Türkçe (Turkish)', value: 'Turkish' },
    { label: 'العربية (Arabic)', value: 'Arabic' },
    { label: 'Français (French)', value: 'French' },
    { label: 'Deutsch (German)', value: 'German' },
  ];

  const categoryOptions = [
    { label: '🐾 Pet Supplies & Furniture', value: 'Pet Supplies & Furniture' },
    { label: '🛋️ Home & Decor', value: 'Home & Furniture' },
    { label: '👕 Apparel & Fashion', value: 'Apparel & Fashion' },
    { label: '🔌 Electronics', value: 'Electronics' },
    { label: '📦 General', value: 'General E-Commerce' },
  ];

  const [mode, setMode] = useState<"enhance" | "create">("enhance");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [newTitleInput, setNewTitleInput] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newPrice, setNewPrice] = useState("29.99");
  const [newSku, setNewSku] = useState("PRO-SKU-01");

  const [language, setLanguage] = useState("English");
  const [category, setCategory] = useState("Pet Supplies & Furniture");
  
  const [rawSpecs, setRawSpecs] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [unit, setUnit] = useState("cm");
  const [isEco, setIsEco] = useState("no");
  const [hasWarranty, setHasWarranty] = useState("no");
  const [warrantyPeriod, setWarrantyPeriod] = useState("");
  const [requiresSafety, setRequiresSafety] = useState("yes");
  const [keywords, setKeywords] = useState("");

  const [editableSeoTitle, setEditableSeoTitle] = useState("");
  const [editableMetaTitle, setEditableMetaTitle] = useState("");
  const [editableMetaDesc, setEditableMetaDesc] = useState("");

  const activeProductNode = (products || []).find((edge: any) => edge.node.id === selectedProduct)?.node;
  const activeImageUrl = activeProductNode?.images?.edges?.[0]?.node?.url;

  const isGenerating = nav.state === "submitting" && nav.formData?.get("_action") === "generate";
  const isInjecting = nav.state === "submitting" && nav.formData?.get("_action") === "inject";

  useEffect(() => {
    if (actionData?.actionType === "generate" && actionData.success) {
      setEditableSeoTitle(actionData.seoTitle || "");
      setEditableMetaTitle(actionData.metaTitle || "");
      setEditableMetaDesc(actionData.metaDescription || "");
    }
    if (actionData?.actionType === "inject" && actionData.success) {
      if (typeof shopify !== 'undefined') shopify.toast.show("Saved to Shopify!");
    }
  }, [actionData]);

  return (
    <Page title="VisionSpec Pro AI" subtitle="Enterprise Product Intelligence & Smart Creator Suite">
      <BlockStack gap="500">
        <Layout>
          
          {actionData?.actionType === "inject" && actionData.success && (
            <Layout.Section>
              <Banner tone="success" title="Success!">{actionData.message}</Banner>
            </Layout.Section>
          )}

          {actionData?.error && (
            <Layout.Section>
              <Banner tone="critical" title="Error">{actionData.error}</Banner>
            </Layout.Section>
          )}

          {/* Mode Selector Tabs */}
          <Layout.Section>
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Select Operational Mode</Text>
                <ButtonGroup>
                  <Button variant={mode === "enhance" ? "primary" : "secondary"} onClick={() => setMode("enhance")}>
                    🔄 Enhance Existing Product
                  </Button>
                  <Button variant={mode === "create" ? "primary" : "secondary"} onClick={() => setMode("create")}>
                    ✨ Create New Product from Scratch
                  </Button>
                </ButtonGroup>
              </InlineStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Form method="post">
              <input type="hidden" name="_action" value="generate" />
              <input type="hidden" name="mode" value={mode} />
              
              <Grid>
                {/* Left Column: Product Selection or Creation Inputs */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">
                        {mode === "enhance" ? "1. Select Existing Product" : "1. New Product Details"}
                      </Text>

                      {mode === "enhance" ? (
                        <>
                          <Select
                            label="Target Product"
                            name="selectedProduct"
                            options={productOptions}
                            onChange={setSelectedProduct}
                            value={selectedProduct}
                          />
                          {activeProductNode && (
                            <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                              <InlineStack gap="300" blockAlign="center">
                                {activeImageUrl && <img src={activeImageUrl} alt="" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px' }} />}
                                <div>
                                  <Text as="p" fontWeight="bold">{activeProductNode.title}</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">Vendor: {activeProductNode.vendor || 'N/A'}</Text>
                                </div>
                              </InlineStack>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <TextField
                            label="Product Title / Name"
                            name="newTitleInput"
                            value={newTitleInput}
                            onChange={setNewTitleInput}
                            autoComplete="off"
                            placeholder="e.g. Pugalo Triangular Cat House"
                          />
                          <TextField
                            label="Product Image URL (Optional)"
                            name="newImageUrl"
                            value={newImageUrl}
                            onChange={setNewImageUrl}
                            autoComplete="off"
                            placeholder="[https://example.com/image.jpg](https://example.com/image.jpg)"
                            helpText="Paste image link for AI visual analysis."
                          />
                          <InlineStack gap="300">
                            <div style={{flex: 1}}><TextField label="Price ($)" name="newPrice" value={newPrice} onChange={setNewPrice} autoComplete="off" /></div>
                            <div style={{flex: 1}}><TextField label="SKU" name="newSku" value={newSku} onChange={setNewSku} autoComplete="off" /></div>
                          </InlineStack>
                        </>
                      )}

                      <Select
                        label="Industry Template"
                        name="category"
                        options={categoryOptions}
                        onChange={setCategory}
                        value={category}
                      />
                      
                      <Select
                        label="Output Language"
                        name="language"
                        options={languageOptions}
                        onChange={setLanguage}
                        value={language}
                      />

                      <TextField
                        label="Focus SEO Keywords"
                        name="keywords"
                        value={keywords}
                        onChange={setKeywords}
                        autoComplete="off"
                        placeholder="e.g. cat scratching post, natural jute"
                      />
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* Right Column: Factory Specs & Ground Truth */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">2. Factory Specs & Ground Truth</Text>
                      
                      <TextField
                        label="Smart Factory Specs Parser (Paste Multi-Part Specs)"
                        name="rawSpecs"
                        value={rawSpecs}
                        onChange={setRawSpecs}
                        multiline={4}
                        autoComplete="off"
                        placeholder="Nest: 36x30x37 cm | Base: 42x56 cm | Height: 85 cm"
                        helpText="Paste complex dimensions raw—AI structures them into a table."
                      />

                      <Divider />

                      <InlineStack gap="300" wrap={false}>
                        <div style={{flex: 1}}><TextField label="Length" name="length" type="number" value={length} onChange={setLength} autoComplete="off" /></div>
                        <div style={{flex: 1}}><TextField label="Width" name="width" type="number" value={width} onChange={setWidth} autoComplete="off" /></div>
                        <div style={{flex: 1}}><TextField label="Height" name="height" type="number" value={height} onChange={setHeight} autoComplete="off" /></div>
                        <div style={{flex: 1}}>
                          <Select label="Unit" name="unit" options={[{label:'cm', value:'cm'}, {label:'inch', value:'inch'}]} value={unit} onChange={setUnit} />
                        </div>
                      </InlineStack>

                      <InlineStack gap="400">
                        <div style={{flex: 1}}>
                          <Select
                            label="Eco-Friendly?"
                            name="isEco"
                            options={[{label: 'No', value: 'no'}, {label: 'Yes', value: 'yes'}]}
                            value={isEco}
                            onChange={setIsEco}
                          />
                        </div>
                        <div style={{flex: 1}}>
                          <Select
                            label="EU Safety Notice?"
                            name="requiresSafety"
                            options={[{label: 'Yes (Add EU GPSR)', value: 'yes'}, {label: 'No', value: 'no'}]}
                            value={requiresSafety}
                            onChange={setRequiresSafety}
                          />
                        </div>
                      </InlineStack>

                      <InlineStack gap="400" blockAlign="end">
                        <div style={{flex: 1}}>
                          <Select
                            label="Warranty?"
                            name="hasWarranty"
                            options={[{label: 'No', value: 'no'}, {label: 'Yes', value: 'yes'}]}
                            value={hasWarranty}
                            onChange={setHasWarranty}
                          />
                        </div>
                        {hasWarranty === 'yes' && (
                          <div style={{flex: 1}}>
                            <TextField
                              label="Duration"
                              name="warrantyPeriod"
                              value={warrantyPeriod}
                              onChange={setWarrantyPeriod}
                              autoComplete="off"
                              placeholder="12 Months"
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
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodyMd">Generate complete sales copy, multi-part tech table & SEO metadata.</Text>
                    <Button submit variant="primary" size="large" loading={isGenerating} disabled={mode === "enhance" && !selectedProduct}>
                      Generate Smart Listing ✨
                    </Button>
                  </InlineStack>
                </Card>
              </div>
            </Form>
          </Layout.Section>

          {/* Output & Preview Section */}
          {actionData?.actionType === "generate" && actionData.success && actionData.generatedContent && (
            <Layout.Section>
              <Card>
                <Form method="post">
                  <input type="hidden" name="_action" value="inject" />
                  <input type="hidden" name="mode" value={actionData.mode} />
                  <input type="hidden" name="productId" value={actionData.selectedProduct} />
                  <input type="hidden" name="htmlContent" value={actionData.generatedContent} />
                  <input type="hidden" name="seoTitle" value={editableSeoTitle} />
                  <input type="hidden" name="metaTitle" value={editableMetaTitle} />
                  <input type="hidden" name="metaDescription" value={editableMetaDesc} />
                  <input type="hidden" name="newPrice" value={newPrice} />
                  <input type="hidden" name="newSku" value={newSku} />
                  <input type="hidden" name="newImageUrl" value={actionData.newImageUrl || ""} />

                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">3. Review & Publish</Text>
                      <Button submit variant="primary" size="large" loading={isInjecting}>
                        {actionData.mode === "create" ? "Publish New Product to Shopify 🚀" : "Update Shopify Product 🚀"}
                      </Button>
                    </InlineStack>

                    <Divider />

                    <TextField label="Optimized Title" value={editableSeoTitle} onChange={setEditableSeoTitle} autoComplete="off" />
                    
                    <Grid>
                      <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                        <TextField label="SEO Meta Title" value={editableMetaTitle} onChange={setEditableMetaTitle} autoComplete="off" />
                      </Grid.Cell>
                      <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                        <TextField label="SEO Meta Description" value={editableMetaDesc} onChange={setEditableMetaDesc} autoComplete="off" multiline={2} />
                      </Grid.Cell>
                    </Grid>

                    <Divider />

                    <Text as="h3" variant="headingMd">Preview</Text>
                    <div 
                      style={{ padding: '24px', backgroundColor: '#fff', border: '1px solid #dfe3e8', borderRadius: '8px' }}
                      dangerouslySetInnerHTML={{ __html: actionData.generatedContent }} 
                    />
                  </BlockStack>
                </Form>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}