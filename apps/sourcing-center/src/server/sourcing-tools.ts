import { pool } from "./db";
import { env } from "./env";

export type CandidateRow = {
  supplier_id: string;
  supplier_no: string;
  supplier_type: "INTERNAL" | "EXTERNAL";
  name: string;
  region: string;
  source_platform: string;
  qualifications: string[];
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  minimum_delivery_days: number;
  description: string;
  match_score: number;
};

async function waitForMockApi(extraDelayMs: number) {
  if (env.SOURCING_TOOL_DELAY_MS === 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, env.SOURCING_TOOL_DELAY_MS + extraDelayMs);
  });
}

async function querySupplierCapabilities(
  itemCode: string,
  supplierType: CandidateRow["supplier_type"],
  sourcePlatform: string | null,
) {
  return (await pool.query<CandidateRow>(`
    SELECT s.id AS supplier_id,s.supplier_no,s.supplier_type,s.name,s.region,s.source_platform,s.qualifications,s.risk_level,
           sc.minimum_delivery_days,sc.description,
           greatest(0,least(100,95 + CASE WHEN s.risk_level='LOW' THEN 4 WHEN s.risk_level='MEDIUM' THEN 0 ELSE -12 END))::int AS match_score
    FROM supplier_capabilities sc JOIN suppliers s ON s.id=sc.supplier_id
    WHERE sc.item_code=$1
      AND s.supplier_type=$2
      AND ($3::text IS NULL OR s.source_platform=$3)
    ORDER BY match_score DESC,s.supplier_no`, [itemCode, supplierType, sourcePlatform])).rows;
}

export async function queryInternalSupplierApi(itemCode: string) {
  await waitForMockApi(200);
  return querySupplierCapabilities(itemCode, "INTERNAL", null);
}

export async function query1688SupplierApi(itemCode: string) {
  await waitForMockApi(900);
  return querySupplierCapabilities(itemCode, "EXTERNAL", "1688");
}

export async function queryQichachaSupplierApi(itemCode: string) {
  await waitForMockApi(600);
  return querySupplierCapabilities(itemCode, "EXTERNAL", "企业信息库");
}

export async function queryIndustryPlatformCrawlerApi(itemCode: string) {
  await waitForMockApi(800);
  return querySupplierCapabilities(itemCode, "EXTERNAL", "行业平台");
}

export async function checkSupplierQualificationsApi(rows: CandidateRow[], qualificationCodes: string[]) {
  await waitForMockApi(200);
  const required = qualificationCodes.filter((value) => value !== "NONE");
  return rows.filter((row) => required.every((code) => row.qualifications.includes(code)));
}

export async function checkSupplierDeliveryApi(rows: CandidateRow[], requiredDeliveryDays: number) {
  await waitForMockApi(0);
  return rows.filter((row) => row.minimum_delivery_days <= requiredDeliveryDays);
}
