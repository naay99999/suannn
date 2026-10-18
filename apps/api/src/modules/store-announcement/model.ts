import { t } from 'elysia'

export const storeAnnouncementLimits = { message: 160, linkLabel: 60, linkUrl: 2048, details: 500 } as const

const nullableText = (maxLength: number) => t.Union([t.String({ maxLength }), t.Null()])

export const storeAnnouncementModels = {
  'storeAnnouncement.response': t.Object({
    id: t.Integer({ minimum: 1, maximum: 1 }),
    enabled: t.Boolean(),
    message: t.Union([t.String(), t.Null()]),
    linkLabel: t.Union([t.String(), t.Null()]),
    linkUrl: t.Union([t.String(), t.Null()]),
    details: t.Union([t.String(), t.Null()]),
    startsAt: t.Union([t.Date(), t.Null()]),
    endsAt: t.Union([t.Date(), t.Null()]),
    version: t.Integer({ minimum: 1 }),
    updatedAt: t.Date(),
  }, { additionalProperties: false }),
  'storeAnnouncement.updateBody': t.Object({
    enabled: t.Boolean(),
    message: nullableText(storeAnnouncementLimits.message),
    linkLabel: nullableText(storeAnnouncementLimits.linkLabel),
    linkUrl: nullableText(storeAnnouncementLimits.linkUrl),
    details: nullableText(storeAnnouncementLimits.details),
    startsAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
    endsAt: t.Union([t.String({ format: 'date-time' }), t.Null()]),
  }, { additionalProperties: false }),
  'storeAnnouncement.public': t.Object({
    announcement: t.Union([t.Object({
      message: t.String(),
      linkLabel: t.Union([t.String(), t.Null()]),
      linkUrl: t.Union([t.String(), t.Null()]),
      details: t.Union([t.String(), t.Null()]),
    }, { additionalProperties: false }), t.Null()]),
  }, { additionalProperties: false }),
}
