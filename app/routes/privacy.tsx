export default function PrivacyPolicy() {
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: "1.6", color: "#333", maxWidth: "800px", margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ textAlign: "center", marginBottom: "40px" }}>
        <h1 style={{ fontSize: "2.5rem", color: "#111827", marginBottom: "10px" }}>Privacy Policy</h1>
        <p style={{ color: "#6b7280", fontSize: "1.1rem" }}>VisionSpec Pro AI</p>
      </div>

      <div style={{ backgroundColor: "#fff", padding: "30px", borderRadius: "8px", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)" }}>
        
        <h2 style={{ fontSize: "1.5rem", color: "#1f2937", marginTop: "0", borderBottom: "2px solid #e5e7eb", paddingBottom: "10px" }}>1. Information We Collect</h2>
        <p style={{ marginBottom: "24px" }}>
          VisionSpec Pro AI operates as a B2B product enhancement tool. We do <strong>NOT</strong> collect, store, or process any personal customer data, buyer information, or financial details. We only process product data (titles, descriptions, specs, and images) that you explicitly provide through the app interface.
        </p>

        <h2 style={{ fontSize: "1.5rem", color: "#1f2937", borderBottom: "2px solid #e5e7eb", paddingBottom: "10px" }}>2. Third-Party Services</h2>
        <p style={{ marginBottom: "24px" }}>
          We use Google Gemini AI API to generate product descriptions, variants, and SEO metadata. The product data you input is sent securely to Google's API strictly for processing the requested output.
        </p>

        <h2 style={{ fontSize: "1.5rem", color: "#1f2937", borderBottom: "2px solid #e5e7eb", paddingBottom: "10px" }}>3. Data Retention & Deletion (GDPR Compliance)</h2>
        <p style={{ marginBottom: "24px" }}>
          Since we do not store your shop's product database on our own servers (we inject it directly back into your Shopify store), there is no long-term retention of your data on our infrastructure. If you uninstall the app, any temporary processing logs and active sessions are automatically purged.
        </p>

        <h2 style={{ fontSize: "1.5rem", color: "#1f2937", borderBottom: "2px solid #e5e7eb", paddingBottom: "10px" }}>4. Contact Us</h2>
        <p style={{ marginBottom: "0" }}>
          If you have any questions about this Privacy Policy, please contact Kian Tech Solutions at: <strong>walid@kian.business</strong>
        </p>
        
      </div>
    </div>
  );
}