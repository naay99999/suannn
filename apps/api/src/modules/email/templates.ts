export interface EmailContent {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function linkEmail(subject: string, message: string, action: string, url: string): EmailContent {
  const safeUrl = escapeHtml(url)

  return {
    subject,
    text: `${message}\n\n${url}`,
    html: `<p>${escapeHtml(message)}</p><p><a href="${safeUrl}">${escapeHtml(action)}</a></p>`,
  }
}

export function verificationEmail(url: string) {
  return linkEmail(
    'ยืนยันอีเมลสำหรับบัญชี Suannn',
    'กดลิงก์ด้านล่างเพื่อยืนยันอีเมลและเปิดใช้งานบัญชี Suannn ของคุณ',
    'ยืนยันอีเมล',
    url,
  )
}

export function resetPasswordEmail(url: string) {
  return linkEmail(
    'ตั้งรหัสผ่าน Suannn ใหม่',
    'ใช้ลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ หากคุณไม่ได้ขอเปลี่ยนรหัสผ่าน ไม่ต้องดำเนินการใดๆ',
    'ตั้งรหัสผ่านใหม่',
    url,
  )
}

export function invitationEmail(roleName: string, url: string) {
  return linkEmail(
    'You are invited to Suannn Admin',
    `You have been invited to Suannn Admin with the ${roleName} role.`,
    'Accept invitation',
    url,
  )
}

export function staffMfaRecoveryEmail(url: string) {
  return linkEmail(
    'Reset your Suannn Admin MFA',
    'Your staff MFA was reset through the emergency owner recovery process. Sign in and enroll a new authenticator before using the backoffice.',
    'Enroll a new authenticator',
    url,
  )
}

export function changeEmailCodeEmail(code: string): EmailContent {
  return {
    subject: 'ยืนยันอีเมลใหม่ของบัญชี Suannn',
    text: `ใช้รหัสนี้เพื่อยืนยันอีเมลใหม่: ${code}\n\nรหัสจะหมดอายุใน 10 นาที`,
    html: `<p>ใช้รหัสนี้เพื่อยืนยันอีเมลใหม่: <strong>${escapeHtml(code)}</strong></p><p>รหัสจะหมดอายุใน 10 นาที</p>`,
  }
}

function orderUrl(orderId: string, storefrontUrl: string, guest: boolean) {
  const storefront = new URL(storefrontUrl)
  if (storefront.protocol !== 'https:' && storefront.protocol !== 'http:') throw new Error('INVALID_STOREFRONT_URL')
  const path = guest ? `/orders/guest/${encodeURIComponent(orderId)}` : `/account/orders/${encodeURIComponent(orderId)}`
  return new URL(path, storefront).toString()
}

function orderEmail(subject: string, lines: string[], url: string, action: string): EmailContent {
  return {
    subject,
    text: `${lines.join('\n')}\n\n${action}: ${url}`,
    html: `${lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>`,
  }
}

export function orderConfirmationEmail(
  orderId: string,
  orderNumber: string,
  storefrontUrl: string,
  guestAccessToken?: string,
): EmailContent {
  const url = orderUrl(orderId, storefrontUrl, Boolean(guestAccessToken))
  const content = orderEmail(`ยืนยันคำสั่งซื้อ ${orderNumber} จาก Suannn`, [
    'ร้านได้รับคำสั่งซื้อของคุณแล้ว',
    `หมายเลขคำสั่งซื้อ: ${orderNumber}`,
  ], url, 'ดูคำสั่งซื้อ')
  if (!guestAccessToken) return content

  // The guest token is shown as text only, never inside a link.
  return {
    subject: content.subject,
    text: `${content.text}\n\nกรอกรหัสเข้าดูคำสั่งซื้อนี้ในหน้าดังกล่าว:\n${guestAccessToken}`,
    html: `${content.html}<p>กรอกรหัสเข้าดูคำสั่งซื้อนี้ในหน้าดังกล่าว:</p><p><code>${escapeHtml(guestAccessToken)}</code></p>`,
  }
}

export interface ShipmentEmailDetails {
  carrierLabel: string
  trackingNumber: string
}

export function orderShippedEmail(
  orderId: string,
  orderNumber: string,
  storefrontUrl: string,
  guest: boolean,
  shipment: ShipmentEmailDetails,
): EmailContent {
  return orderEmail(`คำสั่งซื้อ ${orderNumber} จัดส่งแล้ว`, [
    'ร้านส่งสินค้าของคุณแล้ว',
    `หมายเลขคำสั่งซื้อ: ${orderNumber}`,
    `ขนส่ง: ${shipment.carrierLabel}`,
    `เลขพัสดุ: ${shipment.trackingNumber}`,
  ], orderUrl(orderId, storefrontUrl, guest), 'ดูคำสั่งซื้อและติดตามพัสดุ')
}

export function orderCancelledEmail(orderId: string, orderNumber: string, storefrontUrl: string, guest: boolean): EmailContent {
  return orderEmail(`คำสั่งซื้อ ${orderNumber} ถูกยกเลิก`, [
    'คำสั่งซื้อนี้ถูกยกเลิกแล้ว หากชำระเงินออนไลน์ไว้ ร้านจะแจ้งเมื่อคืนเงินเรียบร้อย',
    `หมายเลขคำสั่งซื้อ: ${orderNumber}`,
  ], orderUrl(orderId, storefrontUrl, guest), 'ดูคำสั่งซื้อ')
}

export function orderRefundedEmail(
  orderId: string,
  orderNumber: string,
  storefrontUrl: string,
  guest: boolean,
  amountSatang: number,
): EmailContent {
  const amount = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amountSatang / 100)
  return orderEmail(`คืนเงินคำสั่งซื้อ ${orderNumber} แล้ว`, [
    `ร้านคืนเงิน ${amount} ไปยังช่องทางที่คุณชำระแล้ว ระยะเวลาที่เงินเข้าขึ้นอยู่กับธนาคารหรือผู้ออกบัตร`,
    `หมายเลขคำสั่งซื้อ: ${orderNumber}`,
  ], orderUrl(orderId, storefrontUrl, guest), 'ดูคำสั่งซื้อ')
}
