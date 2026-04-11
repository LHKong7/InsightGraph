export interface GraphNode {
  id: string;
  label: string;
  type: string; // Entity, Claim, Metric, Report, etc.
  props: Record<string, any>;
  color?: string;
  size?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  props?: Record<string, any>;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface SearchResult {
  text: string;
  score: number;
  result_type: string;
  source: string;
  page?: number;
  section_title?: string;
  report_title?: string;
  claim_id?: string;
  paragraph_id?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  findings?: string[];
  evidence?: any[];
  confidence?: number;
}
