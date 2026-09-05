import type { ThemeConfig } from 'antd'

/** Ant Design v6 Light 默认种子，见 https://ant.design/design.md */
export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#1677FF',
    colorSuccess: '#52C41A',
    colorWarning: '#FAAD14',
    colorError: '#FF4D4F',
    colorInfo: '#1677FF',
    colorBgLayout: '#F5F5F5',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorText: 'rgba(0, 0, 0, 0.88)',
    colorTextSecondary: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 6,
    fontSize: 14,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    controlHeight: 32,
  },
  components: {
    Layout: {
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
      bodyBg: '#F5F5F5',
      headerHeight: 56,
      headerPadding: '0 24px',
    },
    Menu: {
      itemSelectedBg: '#E6F4FF',
      itemSelectedColor: '#1677FF',
    },
    Card: {
      paddingLG: 24,
      borderRadiusLG: 8,
    },
    Table: {
      headerBg: '#FAFAFA',
      headerColor: 'rgba(0, 0, 0, 0.88)',
    },
  },
}
