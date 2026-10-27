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
  ButtonGroup,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { GoogleGenAI, Type } from "@google/genai";

// 1. Loader: سحب المنتجات الحالية من شوبيفاي
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

// دالة ذكية لاستخراج رابط الصورة المباشر من صفحة الموقع (مثل pugalopet.com)
async function resolveDirectImageUrl(inputUrl: string): Promise<string> {
  if (!inputUrl) return "";
  const trimmed = inputUrl.trim();
  
  if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const res = await fetch(trimmed, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();

    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    
    if (ogMatch && ogMatch[1]) {
      return new URL(ogMatch[1], trimmed).href;
    }

    const twitterMatch =
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);

    if (twitterMatch && twitterMatch[1]) {
      return new URL(twitterMatch[1], trimmed).href;
    }

    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (imgMatch && imgMatch[1]) {
      return new URL(imgMatch[1], trimmed).href;
    }
  } catch (e) {
    // ignore fetch errors silently
  }
  return "";
}

// دالة تنظيف احتياطية مضادة للرصاص لمنع ظهور {"seoTitle" أو \n نهائياً
function cleanAndExtractJson(rawText: string, fallbackTitle: string) {
  let cleaned = rawText.replace(/```json/gi, "").replace(/```html/gi, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      seoTitle: parsed.seoTitle || fallbackTitle,
      metaTitle: parsed.metaTitle || fallbackTitle.slice(0, 60),
      metaDescription: parsed.metaDescription || "High quality product verified by VisionSpec Pro AI.",
      htmlContent: (parsed.htmlContent || "").replace(/\\n/g, "\n").replace(/\\"/g, '"'),
    };
  } catch (e) {
    const seoTitleMatch = cleaned.match(/"seoTitle"\s*:\s*"([^"]+)"/);
    const metaTitleMatch = cleaned.match(/"metaTitle"\s*:\s*"([^"]+)"/);
    const metaDescMatch = cleaned.match(/"metaDescription"\s*:\s*"([^"]+)"/);
    const htmlMatch = cleaned.match(/"htmlContent"\s*:\s*"([\s\S]*)"\s*\}/);

    let extractedHtml = htmlMatch ? htmlMatch[1] : cleaned;
    extractedHtml = extractedHtml
      .replace(/^\s*\{\s*"seoTitle"[\s\S]*?"htmlContent"\s*:\s*"/i, "")
      .replace(/"\s*\}\s*$/i, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .trim();

    return {
      seoTitle: seoTitleMatch ? seoTitleMatch[1] : fallbackTitle,
      metaTitle: metaTitleMatch ? metaTitleMatch[1] : fallbackTitle.slice(0, 60),
      metaDescription: metaDescMatch ? metaDescMatch[1] : "High quality product verified by VisionSpec Pro AI.",
      htmlContent: extractedHtml,
    };
  }
}

async function generateWithRetry(ai: GoogleGenAI, modelName: string, contents: any, config: any, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await ai.models.generateContent({ model: modelName, contents, config });
    } catch (error: any) {
      if ((error.status === 503 || error.code === 503 || JSON.stringify(error).includes("503")) && i < retries - 1) {
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      throw error;
    }
  }
}

// 2. Action
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "generate") {
    const mode = formData.get("mode") as string;
    const productId = formData.get("selectedProduct") as string;
    const language = formData.get("language") as string;
    const category = formData.get("category") as string;
    
    const newTitleInput = formData.get("newTitleInput") as string;
    const newImageUrl = formData.get("newImageUrl") as string;
    const newPrice = formData.get("newPrice") as string;
    const newSku = formData.get("newSku") as string;
    const colorOptions = formData.get("colorOptions") as string;

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
      let resolvedImageUrl = "";
      let productContext = "";

      if (mode === "enhance") {
        const productRes = await admin.graphql(
          `query getProduct($id: ID!) {
            product(id: $id) {
              title
              vendor
              descriptionHtml
              images(first: 1) { edges { node { url } } }
            }
          }`,
          { variables: { id: productId } }
        );
        const productData = await productRes.json();
        const product = productData?.data?.product;
        if (!product) return Response.json({ error: "Product not found." });

        baseTitle = product.title;
        resolvedImageUrl = product.images?.edges[0]?.node?.url || "";
        productContext = `Vendor: ${product.vendor || 'N/A'}\nOriginal Description: ${product.descriptionHtml || 'None'}`;
      } else {
        resolvedImageUrl = await resolveDirectImageUrl(newImageUrl);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash"; 
      
      const systemPrompt = `You are an elite E-Commerce Conversion Copywriter, Technical Engineer, and SEO Specialist.
Analyze the provided product title, image (if available), and STRICT GROUND-TRUTH FACTS.

CRITICAL RULES:
1. Write all output entirely in ${language}.
2. ZERO HALLUCINATION POLICY: Never invent dimensions, sub-component measurements, or warranties. Use ONLY the merchant's facts and raw factory specs.
3. Parse every single dimension, material, Stock Code/SKU, and Available Color Options into separate, well-organized rows inside the HTML Technical Specifications table.
4. Industry Context: Tailor the benefits and tone for "${category}".
5. For "htmlContent", output pure, valid HTML ONLY following the exact template below (do NOT include literal "\\n" text strings).

HTML TEMPLATE FOR "htmlContent":
<div class="visionspec-smart-listing" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; line-height: 1.6;">
  <h2 style="font-size: 1.4em; font-weight: 700; color: #111827; margin-bottom: 12px;">[Insert Catchy Headline]</h2>
  <p style="margin-bottom: 16px; font-size: 1.05em; color: #374151;">[Engaging opening paragraph highlighting primary benefits]</p>
  
  <h3 style="font-size: 1.15em; font-weight: 600; color: #111827; margin-top: 24px; margin-bottom: 12px;">✨ Key Highlights & Features</h3>
  <ul style="margin-bottom: 24px; padding-left: 20px; color: #374151;">
    <li style="margin-bottom: 8px;"><strong>[Feature 1]:</strong> [Explanation]</li>
    <li style="margin-bottom: 8px;"><strong>[Feature 2]:</strong> [Explanation]</li>
    <li style="margin-bottom: 8px;"><strong>[Feature 3]:</strong> [Explanation]</li>
  </ul>

  <h3 style="font-size: 1.15em; font-weight: 600; color: #111827; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px;">📐 Technical Specifications</h3>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 0.95em; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
    <thead>
      <tr style="background-color: #111827; color: #ffffff; text-align: left;">
        <th style="padding: 12px 16px; width: 40%;">Specification</th>
        <th style="padding: 12px 16px;">Details</th>
      </tr>
    </thead>
    <tbody>
      [Generate alternating table rows (#ffffff and #f9fafb) with padding: 12px 16px; border-bottom: 1px solid #e5e7eb;]
    </tbody>
  </table>

  [IF Safety Notice is YES, include this exact block, otherwise OMIT]:
  <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin-top: 24px; border-radius: 6px;">
    <strong style="color: #991b1b; display: block; margin-bottom: 4px; font-size: 0.95em;">🛡️ EU GPSR & Product Safety Compliance</strong>
    <p style="margin: 0; color: #7f1d1d; font-size: 0.9em;">Keep away from open flames. Inspect periodically for wear or loose parts. Complies with General Product Safety Regulation (EU) 2023/988 consumer standards.</p>
  </div>
</div>`;

      let facts = `MERCHANT GROUND-TRUTH FACTS:\n`;
      if (rawSpecs) facts += `- Raw Factory Specs:\n${rawSpecs}\n`;
      if (colorOptions) facts += `- Available Colors / Variations: ${colorOptions}\n`;
      if (newSku && mode === "create") facts += `- Factory Stock Code / SKU: ${newSku}\n`;
      if (length || width || height) facts += `- Overall Dimensions: ${length || '-'} x ${width || '-'} x ${height || '-'} ${unit}\n`;
      if (isEco === 'yes') facts += `- Sustainability: Eco-Friendly & Non-Toxic Materials\n`;
      if (hasWarranty === 'yes' && warrantyPeriod) facts += `- Warranty: ${warrantyPeriod}\n`;
      if (hasWarranty === 'no') facts += `- Warranty: None\n`;
      facts += `- Include EU Safety Notice Block: ${requiresSafety === 'yes' ? 'YES' : 'NO'}\n`;
      if (keywords) facts += `- Target SEO Keywords: ${keywords}\n`;

      const textPart = `Product Title: ${baseTitle}\n${productContext}\n\n${facts}`;
      let contents: any[] = [];
      
      if (resolvedImageUrl) {
        try {
          const imgFetch = await fetch(resolvedImageUrl);
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

      const generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            seoTitle: { type: Type.STRING },
            metaTitle: { type: Type.STRING },
            metaDescription: { type: Type.STRING },
            htmlContent: { type: Type.STRING },
          },
          required: ["seoTitle", "metaTitle", "metaDescription", "htmlContent"],
        },
      };

      const response = await generateWithRetry(ai, modelName, contents, generationConfig);
      const rawText = response?.text || "";
      const parsedResult = cleanAndExtractJson(rawText, baseTitle);

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
        newImageUrl: resolvedImageUrl,
        newPrice,
        newSku,
        colorOptions,
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
    const newImageUrl = formData.get("newImageUrl") as string;
    const newPrice = (formData.get("newPrice") as string) || "";
    const newSku = (formData.get("newSku") as string) || "";
    const colorOptionsRaw = (formData.get("colorOptions") as string) || "";

    if (!htmlContent) return Response.json({ error: "Missing content." });

    const parsedColors = colorOptionsRaw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    try {
      if (mode === "create") {
        // 1. إنشاء المنتج مع خيار الألوان (إن وجد)
        const createMutation = `
          mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
            productCreate(input: $input, media: $media) {
              product {
                id
                title
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                    }
                  }
                }
              }
              userErrors { field message }
            }
          }`;

        const productInput: any = {
          title: seoTitle,
          descriptionHtml: htmlContent,
          seo: { title: metaTitle, description: metaDescription },
        };

        if (parsedColors.length > 0) {
          productInput.productOptions = [
            {
              name: "Color",
              values: parsedColors.map((colorName) => ({ name: colorName })),
            },
          ];
        }

        const mediaInput = newImageUrl ? [{ originalSource: newImageUrl, mediaContentType: "IMAGE" }] : [];

        const createRes = await admin.graphql(createMutation, {
          variables: { input: productInput, media: mediaInput }
        });

        const createData = await createRes.json();
        const userErrors = createData?.data?.productCreate?.userErrors;

        if (userErrors && userErrors.length > 0) {
          return Response.json({ error: `Shopify Create Error: ${userErrors.map((e:any)=>e.message).join(", ")}` });
        }

        const createdProduct = createData?.data?.productCreate?.product;
        const createdProductId = createdProduct?.id;
        const existingVariants = createdProduct?.variants?.edges || [];

        // 2. تحديث السعر والـ SKU للمتغير الأول، وإنشاء باقي متغيرات الألوان أوتوماتيكياً!
        if (createdProductId) {
          // أ) تحديث المتغير الأول الذي أنشأه شوبيفاي تلقائياً
          if (existingVariants.length > 0 && (newPrice || newSku)) {
            const firstVariantId = existingVariants[0].node.id;
            const firstColorSuffix = parsedColors.length > 0 ? `-${parsedColors[0].toUpperCase().replace(/\s+/g, "")}` : "";
            const variantUpdatePayload: any = { id: firstVariantId };
            if (newPrice) variantUpdatePayload.price = newPrice;
            if (newSku) variantUpdatePayload.inventoryItem = { sku: `${newSku}${firstColorSuffix}` };

            await admin.graphql(
              `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  productVariants { id }
                  userErrors { field message }
                }
              }`,
              {
                variables: {
                  productId: createdProductId,
                  variants: [variantUpdatePayload],
                },
              }
            );
          }

          // ب) إذا كان هناك أكثر من لون (مثل Blue, Pink, Orange)، ننشئ المتغيرات الإضافية فوراً
          if (parsedColors.length > 1) {
            const additionalVariants = parsedColors.slice(1).map((colorName) => {
              const colorSuffix = `-${colorName.toUpperCase().replace(/\s+/g, "")}`;
              const vInput: any = {
                optionValues: [{ optionName: "Color", name: colorName }],
              };
              if (newPrice) vInput.price = newPrice;
              if (newSku) vInput.inventoryItem = { sku: `${newSku}${colorSuffix}` };
              return vInput;
            });

            await admin.graphql(
              `mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkCreate(productId: $productId, variants: $variants) {
                  productVariants { id title }
                  userErrors { field message }
                }
              }`,
              {
                variables: {
                  productId: createdProductId,
                  variants: additionalVariants,
                },
              }
            );
          }
        }

        return Response.json({ 
          actionType: "inject", 
          success: true, 
          message: `New Product Created with ${parsedColors.length > 0 ? parsedColors.length + " Color Variants, " : ""}Image, Price, SKU & Full SEO! 🎉` 
        });

      } else {
        // وضع Enhance Existing Product
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
  ];

  const categoryOptions = [
    { label: '🐾 Pet Supplies & Furniture', value: 'Pet Supplies & Furniture' },
    { label: '🛋️ Home & Decor', value: 'Home & Furniture' },
    { label: '📦 General', value: 'General E-Commerce' },
  ];

  const [mode, setMode] = useState<"enhance" | "create">("enhance");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [newTitleInput, setNewTitleInput] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [newPrice, setNewPrice] = useState("29.99");
  const [newSku, setNewSku] = useState("SEDFCZ4KHF_89461");
  const [colorOptions, setColorOptions] = useState("Mustard, Blue, Pink, Orange");

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
    <Page title="VisionSpec Pro AI" subtitle="Enterprise Product Intelligence, Multi-Variant & Smart Creator Suite">
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
                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">
                        {mode === "enhance" ? "1. Select Existing Product" : "1. New Product & Variants"}
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
                            placeholder="e.g. Pugalo Large Cat House with Bed"
                          />
                          <TextField
                            label="Product Page URL or Direct Image Link"
                            name="newImageUrl"
                            value={newImageUrl}
                            onChange={setNewImageUrl}
                            autoComplete="off"
                            placeholder="[https://www.pugalopet.com/urun/](https://www.pugalopet.com/urun/)..."
                            helpText="Paste webpage URL (auto-extracts photo) or direct .jpg/.png link."
                          />
                          <InlineStack gap="300" wrap={false}>
                            <div style={{flex: 1}}>
                              <TextField
                                label="Price"
                                name="newPrice"
                                value={newPrice}
                                onChange={setNewPrice}
                                autoComplete="off"
                                placeholder="29.99"
                              />
                            </div>
                            <div style={{flex: 1}}>
                              <TextField
                                label="Stock Code / Base SKU"
                                name="newSku"
                                value={newSku}
                                onChange={setNewSku}
                                autoComplete="off"
                                placeholder="SEDFCZ4KHF_89461"
                              />
                            </div>
                          </InlineStack>
                        </>
                      )}

                      <TextField
                        label="Available Colors / Variations (Comma Separated)"
                        name="colorOptions"
                        value={colorOptions}
                        onChange={setColorOptions}
                        autoComplete="off"
                        placeholder="e.g. Mustard, Blue, Pink, Orange"
                        helpText="Creates real Shopify Color Variants automatically + adds to spec table!"
                      />

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

                <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 6, xl: 6}}>
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">2. Factory Specs & Ground Truth</Text>
                      
                      <TextField
                        label="Smart Factory Specs Parser (Paste Multi-Part Specs)"
                        name="rawSpecs"
                        value={rawSpecs}
                        onChange={setRawSpecs}
                        multiline={5}
                        autoComplete="off"
                        placeholder="DIMENSIONS: Base: 40 x 70 cm; House: 38 x 38 x 38 cm; Scratching Post: 50 cm..."
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
                    <Text as="p" variant="bodyMd">Generate complete sales copy, multi-part tech table, color variants & SEO metadata.</Text>
                    <Button submit variant="primary" size="large" loading={isGenerating} disabled={mode === "enhance" && !selectedProduct}>
                      Generate Smart Listing ✨
                    </Button>
                  </InlineStack>
                </Card>
              </div>
            </Form>
          </Layout.Section>

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
                  <input type="hidden" name="newImageUrl" value={actionData.newImageUrl || ""} />
                  <input type="hidden" name="newPrice" value={actionData.newPrice || newPrice} />
                  <input type="hidden" name="newSku" value={actionData.newSku || newSku} />
                  <input type="hidden" name="colorOptions" value={actionData.colorOptions || colorOptions} />

                  <BlockStack gap="500">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">3. Review & Publish</Text>
                      <Button submit variant="primary" size="large" loading={isInjecting}>
                        {actionData.mode === "create" ? "Publish Product + Variants to Shopify 🚀" : "Update Shopify Product 🚀"}
                      </Button>
                    </InlineStack>

                    <Divider />

                    <InlineStack gap="400" blockAlign="center">
                      {actionData.newImageUrl && (
                        <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', flex: 1 }}>
                          <InlineStack gap="300" blockAlign="center">
                            <img src={actionData.newImageUrl} alt="Extracted Product" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                            <BlockStack gap="100">
                              <Badge tone="success">✓ Product Image Extracted</Badge>
                              <Text as="p" variant="bodySm" tone="subdued">Ready for Shopify media upload.</Text>
                            </BlockStack>
                          </InlineStack>
                        </div>
                      )}

                      {colorOptions && (
                        <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', flex: 1 }}>
                          <BlockStack gap="200">
                            <Badge tone="info">🎨 Auto-Creating Color Variants</Badge>
                            <Text as="p" variant="bodySm" fontWeight="bold">{colorOptions}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">Price: ${newPrice} | Base SKU: {newSku}</Text>
                          </BlockStack>
                        </div>
                      )}
                    </InlineStack>

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

                    <Text as="h3" variant="headingMd">Live Clean HTML Preview</Text>
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