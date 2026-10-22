import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { StaffManagement } from './_components/staff-management'
import { FeatureControls } from './_components/feature-controls'
import { CustomerAuthControls } from './_components/customer-auth-controls'
import { CommerceSettings } from './_components/commerce-settings'
import { ReceiptSettings } from './_components/receipt-settings'
import { StoreAnnouncementSettings } from './_components/store-announcement-settings'
import { TrackingStatus } from './_components/tracking-status'

export function Component() {
  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">System settings</h1>
      <Tabs defaultValue="admin-users">
        <TabsList>
          <TabsTrigger value="admin-users">Admin users</TabsTrigger>
          <TabsTrigger value="feature-controls">Feature controls</TabsTrigger>
          <TabsTrigger value="commerce">Commerce</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="promotion-bar">Promotion bar</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>
        <TabsContent value="admin-users"><StaffManagement /></TabsContent>
        <TabsContent value="feature-controls">
          <div className="flex flex-col gap-6">
            <FeatureControls />
            <CustomerAuthControls />
          </div>
        </TabsContent>
        <TabsContent value="commerce"><CommerceSettings /></TabsContent>
        <TabsContent value="receipts"><ReceiptSettings /></TabsContent>
        <TabsContent value="promotion-bar"><StoreAnnouncementSettings /></TabsContent>
        <TabsContent value="integrations"><TrackingStatus /></TabsContent>
      </Tabs>
    </section>
  )
}
