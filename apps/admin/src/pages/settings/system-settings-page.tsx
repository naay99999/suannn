import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { StaffManagement } from './_components/staff-management'
import { FeatureControls } from './_components/feature-controls'
import { CommerceSettings } from './_components/commerce-settings'

export function Component() {
  return (
    <section className="flex flex-col gap-6 px-4 lg:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">System settings</h1>
      <Tabs defaultValue="admin-users">
        <TabsList>
          <TabsTrigger value="admin-users">Admin users</TabsTrigger>
          <TabsTrigger value="feature-controls">Feature controls</TabsTrigger>
          <TabsTrigger value="commerce">Commerce</TabsTrigger>
        </TabsList>
        <TabsContent value="admin-users"><StaffManagement /></TabsContent>
        <TabsContent value="feature-controls"><FeatureControls /></TabsContent>
        <TabsContent value="commerce"><CommerceSettings /></TabsContent>
      </Tabs>
    </section>
  )
}
