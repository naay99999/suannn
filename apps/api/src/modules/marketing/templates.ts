import type { AdPlatform } from './spend/types'

export interface UtmTemplate {
  platform: AdPlatform
  where: string
  template: string
}

export const UTM_TEMPLATES: UtmTemplate[] = [
  {
    platform: 'meta',
    where: 'Meta: โฆษณา → การติดตาม → พารามิเตอร์ URL',
    template: 'utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}',
  },
  {
    platform: 'tiktok',
    where: 'TikTok: โฆษณา → ปลายทาง → พารามิเตอร์ URL / การติดตาม',
    template: 'utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_ID__&utm_content=__CID__',
  },
  {
    platform: 'google',
    where: 'Google Ads: การตั้งค่าบัญชี → ส่วนต่อท้าย URL สุดท้าย',
    template: 'utm_source=google&utm_medium=paid&utm_campaign={campaignid}&utm_content={creative}',
  },
]
