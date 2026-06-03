import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

interface SectionCard {
  title: string;
  description: string;
  href: string;
  status: "available" | "coming-soon";
}

const SECTIONS: SectionCard[] = [
  {
    title: "Search",
    description: "Find frames across indexed bags by text or by image.",
    href: "/search",
    status: "available",
  },
  {
    title: "Bag Explorer",
    description: "Browse indexed bags, inspect frames, and trigger dataset extraction.",
    href: "/bags",
    status: "available",
  },
  {
    title: "Workspace (legacy)",
    description:
      "Current all-in-one UI: scan bags, run searches, chat with VLM, and launch extractions.",
    href: "/workspace",
    status: "available",
  },
  {
    title: "Datasets",
    description: "Inspect nuScenes-style datasets produced by extraction runs.",
    href: "/datasets",
    status: "coming-soon",
  },
];

export function DashboardPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {SECTIONS.map((section) => (
        <Card key={section.href}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>{section.title}</CardTitle>
              {section.status === "coming-soon" ? (
                <Badge variant="outline">Coming soon</Badge>
              ) : null}
            </div>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent />
          <CardFooter>
            {section.status === "available" ? (
              <Button asChild variant="default">
                <Link to={section.href}>
                  Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                Not available yet
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
