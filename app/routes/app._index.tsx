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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GoogleGenAI } from "@google/genai";

// 1. Loader: سحب المنتجات مع كامل تفاصيلها المخفية (SKU, Variants, Images, Vendor)
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

// 2. Action: التوليد الذكي والحقن الشامل (وصف + عنوان + Google SEO)
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "generate") {
    const productId = formData.get("selectedProduct") as string;
    const language = formData.get("language") as string;
    const category = formData.get("category") as string;
    
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

    if (!productId) return Response.json({ error: "Please select a product first." });

    try {
      const productRes = await admin.graphql(
        `query getProduct($id: ID!) {
          product(id: $id) {
            title
            vendor
            productType
            descriptionHtml
            images(first: 1) { edges { node { url } } }
            variants(first: 15) {
              edges {
                node {
                  sku
                  title
                }
              }
            }
          }
        }`,
        { variables: { id: productId } }
      );
      
      const productData = await productRes.json();
      const product = productData?.data?.product;
      if (!product) return Response.json({ error: "Product not found." });

      const imageUrl = product.images?.edges[0]?.node?.url;
      const skus = Array.from(new Set(product.variants?.edges?.map((e: any) => e.node.sku).filter(Boolean))).join(", ");
      const variantOptions = product.variants?.edges
        ?.map((e: any) => e.node.title)
        .filter((t: string) => t && t !== "Default Title")
        .join(", ");

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash"; 
      
      const systemPrompt = `You are an elite E-Commerce Conversion Copywriter, Technical Engineer, and SEO Specialist.
Analyze the provided product details, product image (if available), and STRICT GROUND-TRUTH FACTS from the merchant.

CRITICAL RULES:
1. Write all output entirely in ${language}.
2. ZERO HALLUCINATION POLICY: Never invent dimensions, sub-component measurements, warranties, or certifications. Use ONLY the merchant's facts, raw factory specs, and clearly visible features from the image.
3. Parse any "Raw Factory / Complex Specs" (such as Nest size, Base dimensions, Midsole, Post height, Jute/Sisal materials) into separate, crystal-clear rows inside the Technical Specifications table.
4. Industry Context: Tailor the tone and benefits for the "${category}" sector.

Return your response as a valid JSON object ONLY (no markdown formatting, no \`\`\`json) with this exact structure:
{
  "seoTitle": "High-converting, SEO-optimized Product Title",
  "metaTitle": "Google Search SEO Title (Max 60 characters)",
  "metaDescription": "Compelling Google Search Meta Description (Max 155 characters)",
  "htmlContent": "Complete HTML for the product description following the exact template below"
}

HTML TEMPLATE FOR "htmlContent":
<div class="visionspec-smart-listing" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; line-height: 1.6;">
  <h2 style="font-size: 1.4em; font-weight: 700; color: #111827; margin-bottom: 12px;">[Insert Catchy Headline]</h2>
  <p style="margin-bottom: 16px; font-size: 1.05em; color: #374151;">[Engaging opening paragraph highlighting primary benefits, comfort/durability, and target use]</p>
  
  <h3 style="font-size: 1.15em; font-weight: 600; color: #111827; margin-top: 24px; margin-bottom: 12px;">✨ Key Highlights & Features</h3>
  <ul style="margin-bottom: 24px; padding-left: 20px; color: #374151;">
    <li style="margin-bottom: 8px;"><strong>[Feature 1 Name]:</strong> [Benefit-driven explanation based on facts/image]</li>
    <li style="margin-bottom: 8px;"><strong>[Feature 2 Name]:</strong> [Benefit-driven explanation]</li>
    <li style="margin-bottom: 8px;"><strong>[Feature 3 Name]:</strong> [Benefit-driven explanation]</li>
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
      [Generate alternating table rows (#ffffff and #f9fafb) with padding: 12px 16px; border-bottom: 1px solid #e5e7eb;. Include SKU, Available Options/Colors, Materials, and every single dimension/sub-dimension provided in Raw Factory Specs or Overall Dimensions. Do NOT include warranty row unless explicitly provided.]
    </tbody>
  </table>

  [IF Safety Notice is YES, include this exact block, otherwise OMIT COMPLETELY]:
  <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin-top: 24px; border-radius: 6px;">
    <strong style="color: #991b1b; display: block; margin-bottom: 4px; font-size: 0.95em;">🛡️ EU GPSR & Product Safety Compliance</strong>
    <p style="margin: 0; color: #7f1d1d; font-size: 0.9em;">Keep away from open flames. Inspect periodically for wear or loose parts. Complies with General Product Safety Regulation (EU) 2023/988 consumer standards.</p>
  </div>
</div>`;

      // Construct Ground Truth String
      let facts = `MERCHANT GROUND-TRUTH FACTS (STRICTLY ENFORCE):\n`;
      if (product.vendor) facts += `- Brand / Vendor: ${product.vendor}\n`;
      if (skus) facts += `- Stock Code (SKU): ${skus}\n`;
      if (variantOptions) facts += `- Available Variants / Colors: ${variantOptions}\n`;
      if (rawSpecs) facts += `- Raw Factory / Multi-Part Specifications (Parse all of these into the table!): \n${rawSpecs}\n`;
      if (length || width || height) facts += `- Overall Dimensions: ${length || '-'} x ${width || '-'} x ${height || '-'} ${unit}\n`;
      if (isEco === 'yes') facts += `- Sustainability: Eco-Friendly & Non-Toxic Materials\n`;
      if (hasWarranty === 'yes' && warrantyPeriod) facts += `- Warranty: ${warrantyPeriod}\n`;
      if (hasWarranty === 'no') facts += `- Warranty: None (Do NOT mention any warranty)\n`;
      facts += `- Include EU Safety Notice Block: ${requiresSafety === 'yes' ? 'YES' : 'NO'}\n`;
      if (keywords) facts += `- Target SEO Keywords: ${keywords}\n`;

      const textPart = `Original Product Title: ${product.title}\n\n${facts}`;
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
            { text: `${systemPrompt}\n\n${textPart}` },
            { inlineData: { data: base64Image, mimeType } }
          ]
        }];
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
          seoTitle: product.title,
          metaTitle: product.title.slice(0, 60),
          metaDescription: "High quality product verified by VisionSpec Pro AI.",
          htmlContent: rawText,
        };
      }

      return Response.json({ 
        actionType: "generate",
        success: true, 
        generatedContent: parsedResult.htmlContent,
        seoTitle: parsedResult.seoTitle,
        metaTitle: parsedResult.metaTitle,
        metaDescription: parsedResult.metaDescription,
        selectedProduct: productId 
      });
    } catch (error: any) {
      return Response.json({ error: `AI Error: ${error.message || "Failed to analyze product."}` });
    }
  }

  if (actionType === "inject") {
    const productId = formData.get("productId") as string;
    const htmlContent = formData.get("htmlContent") as string;
    const seoTitle = formData.get("seoTitle") as string;
    const metaTitle = formData.get("metaTitle") as string;
    const metaDescription = formData.get("metaDescription") as string;
    const applyNewTitle = formData.get("applyNewTitle") === "true";
    const applySeoMeta = formData.get("applySeoMeta") === "true";

    if (!productId || !htmlContent) {
      return Response.json({ error: "Missing product ID or HTML content." });
    }

    try {
      const productInput: any = {
        id: productId,
        descriptionHtml: htmlContent,
      };

      if (applyNewTitle && seoTitle) {
        productInput.title = seoTitle;
      }

      if (applySeoMeta && (metaTitle || metaDescription)) {
        productInput.seo = {
          title: metaTitle,
          description: metaDescription,
        };
      }

      const updateMutation = `
        mutation productUpdate($input: ProductInput!) { 
          productUpdate(input: $input) { 
            product { id } 
            userErrors { field message } 
          } 
        }`;
      
      const updateRes = await admin.graphql(updateMutation, { 
        variables: { input: productInput } 
      });

      const updateData = await updateRes.json();
      const userErrors = updateData?.data?.productUpdate?.userErrors;
      
      if (userErrors && userErrors.length > 0) {
        const errorMsg = userErrors.map((e: any) => e.message).join(", ");
        return Response.json({ error: `Shopify API Error: ${errorMsg}` });
      }

      return Response.json({ 
        actionType: "inject", 
        success: true, 
        message: "Product Description, Technical Specs, and Google SEO Meta updated! 🚀" 
      });
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
    { label: '--- Select a product from your store ---', value: '' },
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
    { label: '🐾 Pet Supplies & Cat/Dog Furniture', value: 'Pet Supplies & Furniture' },
    { label: '🛋️ Home, Furniture & Decor', value: 'Home & Furniture' },
    { label: '👕 Apparel & Fashion', value: 'Apparel & Fashion' },
    { label: '🔌 Electronics & Smart Gadgets', value: 'Electronics' },
    { label: '📦 General E-Commerce Product', value: 'General E-Commerce' },
  ];

  const [selectedProduct, setSelectedProduct] = useState("");
  const [language, setLanguage] = useState("English");
  const [category, setCategory] = useState("Pet Supplies & Furniture");
  
  // Fact-based states
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

  // Injection options
  const [applyNewTitle, setApplyNewTitle] = useState(false);
  const [applySeoMeta, setApplySeoMeta] = useState(true);

  // Editable SEO Preview states
  const [editableSeoTitle, setEditableSeoTitle] = useState("");
  const [editableMetaTitle, setEditableMetaTitle] = useState("");
  const [editableMetaDesc, setEditableMetaDesc] = useState("");

  // Find active product object for Live Inspector
  const activeProductNode = (products || []).find((edge: any) => edge.node.id === selectedProduct)?.node;
  const activeImageUrl = activeProductNode?.images?.edges?.[0]?.node?.url;
  const activeSkus = Array.from(new Set(activeProductNode?.variants?.edges?.map((e: any) => e.node.sku).filter(Boolean))).join(", ");
  const activeVariants = activeProductNode?.variants?.edges
    ?.map((e: any) => e.node.title)
    .filter((t: string) => t && t !== "Default Title")
    .join(", ");

  const isGenerating = nav.state === "submitting" && nav.formData?.get("_action") === "generate";
  const isInjecting = nav.state === "submitting" && nav.formData?.get("_action") === "inject";

  useEffect(() => {
    if (actionData?.actionType === "generate" && actionData.success) {
      setEditableSeoTitle(actionData.seoTitle || "");
      setEditableMetaTitle(actionData.metaTitle || "");
      setEditableMetaDesc(actionData.metaDescription || "");
    }
    if (actionData?.actionType === "inject" && actionData.success) {
      if (typeof shopify !== 'undefined') shopify.toast.show("Product & Google SEO updated!");
    }
  }, [actionData]);

  return (
    <Page 
      title="VisionSpec Pro AI" 
      subtitle="Enterprise Product Intelligence, Multi-Part Spec Builder & Google SEO Engine"
    >
      <BlockStack gap="500">
        <Layout>
          
          {actionData?.actionType === "inject" && actionData.success && (
            <Layout.Section>
              <Banner tone="success" title="Published to Shopify Storefront">
                {actionData.message}
              </Banner>
            </Layout.Section>
          )}

          {actionData?.error && (
            <Layout.Section>
              <Banner tone="critical" title="System Alert">
                {actionData.error}
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section>
            <Form method="post">
              <input type="hidden" name="_action" value="generate" />
              
              <Grid>
                {/* Left Column: Product Inspector & Context */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">1. Product & Visual Inspector</Text>
                        <Badge tone="info">Auto-Sync</Badge>
                      </InlineStack>
                      
                      <Select
                        label="Target Product"
                        name="selectedProduct"
                        options={productOptions}
                        onChange={setSelectedProduct}
                        value={selectedProduct}
                      />

                      {/* Live Visual Preview of Selected Product */}
                      {activeProductNode && (
                        <div style={{ padding: '14px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <InlineStack gap="400" blockAlign="center" wrap={false}>
                            {activeImageUrl ? (
                              <img 
                                src={activeImageUrl} 
                                alt={activeProductNode.title} 
                                style={{ width: '76px', height: '76px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #cbd5e1' }} 
                              />
                            ) : (
                              <div style={{ width: '76px', height: '76px', backgroundColor: '#e2e8f0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#64748b' }}>
                                No Image
                              </div>
                            )}
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="bold">{activeProductNode.title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                <strong>Brand:</strong> {activeProductNode.vendor || 'N/A'} | <strong>SKU:</strong> {activeSkus || 'None'}
                              </Text>
                              {activeVariants && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  <strong>Detected Options:</strong> {activeVariants}
                                </Text>
                              )}
                              <Badge tone={activeImageUrl ? "success" : "warning"}>
                                {activeImageUrl ? "✓ Image Ready for AI Vision Scan" : "No Image Found"}
                              </Badge>
                            </BlockStack>
                          </InlineStack>
                        </div>
                      )}

                      <Select
                        label="Industry & Category Template"
                        name="category"
                        options={categoryOptions}
                        onChange={setCategory}
                        value={category}
                      />
                      
                      <Select
                        label="Target Output Language"
                        name="language"
                        options={languageOptions}
                        onChange={setLanguage}
                        value={language}
                      />

                      <TextField
                        label="Focus SEO Keywords (Optional)"
                        name="keywords"
                        value={keywords}
                        onChange={setKeywords}
                        autoComplete="off"
                        placeholder="e.g. cat scratching post, natural jute, triangular cat house"
                        helpText="Keywords to naturally embed in description and Google Meta tags."
                      />
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* Right Column: Smart Factory Specs & Compliance */}
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">2. Factory Specs & Ground Truth</Text>
                        <Badge tone="success">Zero Hallucination</Badge>
                      </InlineStack>
                      
                      <TextField
                        label="Smart Factory Specs Parser (Paste Multi-Part Specs / Notes)"
                        name="rawSpecs"
                        value={rawSpecs}
                        onChange={setRawSpecs}
                        multiline={4}
                        autoComplete="off"
                        placeholder="Paste raw factory notes here! Example:&#10;Nest: Width 36 cm, Depth 30 cm, Height 37 cm&#10;Midsole size: 35 x 42 cm | Base: 42 x 56 cm&#10;Total height: 85 cm | 42 cm natural jute-wrapped legs"
                        helpText="Have complex multi-part dimensions like PugaloPet? Paste them raw in any format—AI will structure them into a clean engineering table."
                      />

                      <Divider />
                      <Text as="p" variant="bodySm" tone="subdued">Or enter simple overall dimensions:</Text>
                      
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
                            label="Eco-Friendly / Natural?"
                            name="isEco"
                            options={[{label: 'No / Unspecified', value: 'no'}, {label: 'Yes (Highlight Eco)', value: 'yes'}]}
                            value={isEco}
                            onChange={setIsEco}
                          />
                        </div>
                        <div style={{flex: 1}}>
                          <Select
                            label="EU GPSR Safety Box?"
                            name="requiresSafety"
                            options={[{label: 'Yes (Add EU Compliance)', value: 'yes'}, {label: 'No', value: 'no'}]}
                            value={requiresSafety}
                            onChange={setRequiresSafety}
                          />
                        </div>
                      </InlineStack>

                      <InlineStack gap="400" blockAlign="end">
                        <div style={{flex: 1}}>
                          <Select
                            label="Warranty Included?"
                            name="hasWarranty"
                            options={[{label: 'No (Do Not Mention)', value: 'no'}, {label: 'Yes', value: 'yes'}]}
                            value={hasWarranty}
                            onChange={setHasWarranty}
                          />
                        </div>
                        {hasWarranty === 'yes' && (
                          <div style={{flex: 1}}>
                            <TextField
                              label="Warranty Duration"
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
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="bold">Ready to build your high-converting product page?</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Generates Sales Copy + Multi-Part Tech Table + Google Search SEO Meta Tags</Text>
                    </BlockStack>
                    <Button submit variant="primary" size="large" loading={isGenerating} disabled={!selectedProduct}>
                      Generate Complete Smart Listing ✨
                    </Button>
                  </InlineStack>
                </Card>
              </div>
            </Form>
          </Layout.Section>

          {/* Output & SEO Suite Preview Section */}
          {actionData?.actionType === "generate" && actionData.success && actionData.generatedContent && (
            <Layout.Section>
              <Card>
                <Form method="post">
                  <input type="hidden" name="_action" value="inject" />
                  <input type="hidden" name="productId" value={actionData.selectedProduct} />
                  <input type="hidden" name="htmlContent" value={actionData.generatedContent} />
                  <input type="hidden" name="seoTitle" value={editableSeoTitle} />
                  <input type="hidden" name="metaTitle" value={editableMetaTitle} />
                  <input type="hidden" name="metaDescription" value={editableMetaDesc} />
                  <input type="hidden" name="applyNewTitle" value={String(applyNewTitle)} />
                  <input type="hidden" name="applySeoMeta" value={String(applySeoMeta)} />

                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingLg">3. Review & One-Click Storefront Injection</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Verify your generated listing and SEO metadata before publishing.</Text>
                      </BlockStack>
                      <Button submit variant="primary" size="large" loading={isInjecting}>
                        Publish All to Shopify 🚀
                      </Button>
                    </InlineStack>

                    <Divider />

                    {/* Google SEO & Title Booster Box */}
                    <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingMd">🔍 Google Search SEO & Title Booster</Text>
                          <Badge tone="success">PRO Feature</Badge>
                        </InlineStack>

                        <TextField
                          label="AI Suggested Product Title"
                          value={editableSeoTitle}
                          onChange={setEditableSeoTitle}
                          autoComplete="off"
                        />
                        <Checkbox
                          label="Overwrite main Shopify Product Title with this AI-optimized title"
                          checked={applyNewTitle}
                          onChange={setApplyNewTitle}
                        />

                        <Divider />

                        <Grid>
                          <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                            <TextField
                              label="Google SEO Meta Title"
                              value={editableMetaTitle}
                              onChange={setEditableMetaTitle}
                              autoComplete="off"
                              helpText={`${editableMetaTitle.length}/60 characters`}
                            />
                          </Grid.Cell>
                          <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                            <TextField
                              label="Google SEO Meta Description"
                              value={editableMetaDesc}
                              onChange={setEditableMetaDesc}
                              autoComplete="off"
                              multiline={2}
                              helpText={`${editableMetaDesc.length}/155 characters`}
                            />
                          </Grid.Cell>
                        </Grid>

                        <Checkbox
                          label="Automatically inject Google SEO Meta Title & Description into Shopify Product SEO settings"
                          checked={applySeoMeta}
                          onChange={setApplySeoMeta}
                        />
                      </BlockStack>
                    </div>

                    <Divider />

                    <Text as="h3" variant="headingMd">📄 Live Storefront Description Preview</Text>
                    <div 
                      style={{ padding: '24px', backgroundColor: '#ffffff', border: '1px solid #dfe3e8', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
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