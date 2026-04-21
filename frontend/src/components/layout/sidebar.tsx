import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface SidebarProps {
  scanner: ReactNode;
  bags: ReactNode;
  footer?: ReactNode;
  jobs?: ReactNode;
  extractionEnabled?: boolean;
}

export function Sidebar({ scanner, bags, footer, jobs, extractionEnabled }: SidebarProps) {
  if (!extractionEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bags</CardTitle>
          <CardDescription>Scan directories, select bag datasets, and trigger indexing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scanner}
          {bags}
          {footer}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>Manage bags and monitor extraction jobs.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="bags">
          <TabsList className="mb-3 w-full">
            <TabsTrigger value="bags" className="flex-1">Bags</TabsTrigger>
            <TabsTrigger value="jobs" className="flex-1">Jobs</TabsTrigger>
          </TabsList>
          <TabsContent value="bags" className="space-y-4">
            {scanner}
            {bags}
            {footer}
          </TabsContent>
          <TabsContent value="jobs">
            {jobs}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
