/*
 * Product-app navigation. `backed`
 * marks surfaces backed by a session-authenticated /console projection.
 */
export interface NavItem {
  to: string;
  label: string;
  group: "" | "Work" | "Knowledge" | "Connect" | "Account";
  backed?: boolean;
}

export const NAV: NavItem[] = [
  { group: "", to: "/app", label: "Overview", backed: true },

  { group: "Work", to: "/app/search", label: "Search", backed: true },
  { group: "Work", to: "/app/chat", label: "Chat", backed: true },
  { group: "Work", to: "/app/memory", label: "Memory", backed: true },
  { group: "Work", to: "/app/timeline", label: "Timeline", backed: true },

  { group: "Knowledge", to: "/app/graph", label: "Graph", backed: true },
  { group: "Knowledge", to: "/app/facts", label: "Facts", backed: true },
  { group: "Knowledge", to: "/app/relationships", label: "Relationships", backed: true },
  { group: "Knowledge", to: "/app/procedures", label: "Procedures", backed: true },
  { group: "Knowledge", to: "/app/people", label: "People", backed: true },
  { group: "Knowledge", to: "/app/sources", label: "Sources", backed: true },

  { group: "Connect", to: "/app/connectors", label: "Connectors", backed: true },
  { group: "Connect", to: "/app/integrations", label: "API Keys", backed: true },
  { group: "Connect", to: "/app/api-explorer", label: "API Explorer", backed: true },

  { group: "Account", to: "/app/usage", label: "Usage", backed: true },
  { group: "Account", to: "/app/billing", label: "Billing", backed: true },
  { group: "Account", to: "/app/settings", label: "Settings", backed: true },
];

export const NAV_GROUPS: NavItem["group"][] = ["", "Work", "Knowledge", "Connect", "Account"];
