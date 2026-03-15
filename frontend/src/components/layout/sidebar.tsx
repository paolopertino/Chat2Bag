import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

interface SidebarProps {
  scanner: ReactNode;
  bags: ReactNode;
  footer?: ReactNode;
}

export function Sidebar({ scanner, bags, footer }: SidebarProps) {
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
