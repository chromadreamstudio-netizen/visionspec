import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin } = await authenticate.webhook(request);

  if (!admin && topic !== 'SHOP_REDACT' && topic !== 'CUSTOMERS_REDACT' && topic !== 'CUSTOMERS_DATA_REQUEST') {
    throw new Response("Unauthorized", { status: 401 });
  }

  console.log(`Received webhook: ${topic} for shop: ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    
    // مسارات GDPR الإلزامية لقبول التطبيق في متجر شوبيفاي
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      // نرد بـ 200 OK لتأكيد استلام الطلب من شوبيفاي بنجاح (نحن لا نخزن بيانات عملاء أصلاً)
      console.log(`GDPR Webhook ${topic} processed successfully for ${shop}`);
      break;

    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response("Webhook processed", { status: 200 });
};