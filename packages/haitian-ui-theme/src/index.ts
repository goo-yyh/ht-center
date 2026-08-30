export const HAITIAN_THEME_TOKENS = {
  colorPrimary: '#e60012',
  colorInfo: '#1677ff',
  colorSuccess: '#2f8f46',
  colorWarning: '#d9822b',
  colorText: '#2b2b2b',
  colorTextSecondary: '#666666',
  colorBgLayout: '#f8f5f1',
  colorBgSider: '#fffaf5',
  colorMenuSelectedBg: '#fff0f0',
  borderRadius: 8,
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
  primaryShadow: '0 8px 20px rgba(230, 0, 18, 0.24)',
  cardBorder: 'rgba(120, 74, 45, 0.1)',
  cardShadow: '0 14px 34px rgba(70, 43, 30, 0.07)',
} as const;

const baseToken = {
  colorPrimary: HAITIAN_THEME_TOKENS.colorPrimary,
  colorInfo: HAITIAN_THEME_TOKENS.colorInfo,
  colorSuccess: HAITIAN_THEME_TOKENS.colorSuccess,
  colorWarning: HAITIAN_THEME_TOKENS.colorWarning,
  colorText: HAITIAN_THEME_TOKENS.colorText,
  colorTextSecondary: HAITIAN_THEME_TOKENS.colorTextSecondary,
  colorBgLayout: HAITIAN_THEME_TOKENS.colorBgLayout,
  borderRadius: HAITIAN_THEME_TOKENS.borderRadius,
  fontFamily: HAITIAN_THEME_TOKENS.fontFamily,
};

export const haitianAdminTheme = {
  token: baseToken,
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: HAITIAN_THEME_TOKENS.colorBgSider,
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: HAITIAN_THEME_TOKENS.colorMenuSelectedBg,
      itemSelectedColor: HAITIAN_THEME_TOKENS.colorPrimary,
      itemColor: '#4a403b',
      itemHoverColor: HAITIAN_THEME_TOKENS.colorPrimary,
      subMenuItemBg: 'transparent',
    },
    Card: { borderRadiusLG: HAITIAN_THEME_TOKENS.borderRadius },
    Button: { primaryShadow: HAITIAN_THEME_TOKENS.primaryShadow },
  },
};

export const haitianPortalTheme = {
  token: baseToken,
  components: {
    Card: { borderRadiusLG: HAITIAN_THEME_TOKENS.borderRadius },
    Button: { primaryShadow: HAITIAN_THEME_TOKENS.primaryShadow },
  },
};

export const haitianPortalTableTheme = {
  ...haitianPortalTheme,
  components: {
    ...haitianPortalTheme.components,
    Table: { headerBg: HAITIAN_THEME_TOKENS.colorBgSider },
  },
};

export const SOURCING_STATUS_TAG_META = {
  SOURCING_RUNNING: { label: 'Agent 寻源中', color: 'processing', step: 0 },
  SOURCING_READY: { label: '待确认发布', color: 'cyan', step: 0 },
  BIDDING_OPEN: { label: '等待报价', color: 'gold', step: 1 },
  EVALUATION_PENDING: { label: '待 Agent 评估', color: 'purple', step: 2 },
  AWARD_PENDING: { label: '待创建采购申请', color: 'orange', step: 3 },
  COMPLETED: { label: '已完成', color: 'green', step: 3 },
} as const;

export const RFQ_STATUS_TAG_META = {
  OPEN: { label: '报价中', color: 'processing' },
  BIDDING_OPEN: { label: '报价中', color: 'processing' },
  CLOSED: { label: '已结束', color: 'default' },
  EVALUATION_PENDING: { label: '已结束', color: 'default' },
  SUBMITTED: { label: '已提交', color: 'success' },
} as const;

export function getRfqStatusTagMeta(status: string): { label: string; color: string } {
  return RFQ_STATUS_TAG_META[status as keyof typeof RFQ_STATUS_TAG_META]
    ?? { label: status || '未知状态', color: 'default' };
}
