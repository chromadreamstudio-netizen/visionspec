import { Page, Layout, Text, Card, BlockStack } from "@shopify/polaris";

export default function PrivacyPolicy() {
  return (
    <Page title="Privacy Policy - VisionSpec Pro AI">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">1. Information We Collect</Text>
              <Text as="p" variant="bodyMd">
                VisionSpec Pro AI operates as a B2B product enhancement tool. We do NOT collect, store, or process any personal customer data, buyer information, or financial details. We only process product data (titles, descriptions, specs, and images) that you explicitly provide through the app interface.
              </Text>

              <Text as="h2" variant="headingMd">2. Third-Party Services</Text>
              <Text as="p" variant="bodyMd">
                We use Google Gemini AI API to generate product descriptions, variants, and SEO metadata. The product data you input is sent securely to Google's API strictly for processing the requested output.
              </Text>

              <Text as="h2" variant="headingMd">3. Data Retention & Deletion (GDPR Compliance)</Text>
              <Text as="p" variant="bodyMd">
                Since we do not store your shop's product database on our own servers (we inject it directly back into your Shopify store), there is no long-term retention of your data on our infrastructure. If you uninstall the app, any temporary processing logs and active sessions are automatically purged.
              </Text>

              <Text as="h2" variant="headingMd">4. Contact Us</Text>
              <Text as="p" variant="bodyMd">
                If you have any questions about this Privacy Policy, please contact Kian Tech Solutions at: walid@kian.business
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}