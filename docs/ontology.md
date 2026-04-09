# InsightGraph Ontology

This document describes the knowledge graph schema used by InsightGraph.

## Overview

InsightGraph uses an **Evidence-Centric Directed Property Graph** model. The graph captures three layers:

1. **Document structure** - How the report is organized
2. **Semantic knowledge** - What the report says (entities, metrics, claims)
3. **Evidence linkage** - Where each piece of knowledge comes from

## Node Types

### Document Structure Nodes

#### Report
The top-level node representing an ingested document.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| report_id | string | yes | Unique identifier |
| title | string | yes | Document title |
| source_filename | string | yes | Original filename |
| date | string | no | Publication date |
| num_pages | integer | no | Page count |
| domain | string | no | e.g., "equity_research" |
| language | string | no | e.g., "en", "zh" |

#### Section
A document section (chapter, heading).

| Property | Type | Required |
|----------|------|----------|
| section_id | string | yes |
| title | string | no |
| level | integer | yes |
| order | integer | yes |

#### Paragraph
A text block within a section.

| Property | Type | Required |
|----------|------|----------|
| paragraph_id | string | yes |
| text | string | yes |
| page | integer | no |

#### SourceSpan
An exact location in the source document for evidence tracing.

| Property | Type | Required |
|----------|------|----------|
| span_id | string | yes |
| text | string | yes |
| page | integer | yes |
| start_char | integer | no |
| end_char | integer | no |
| block_id | string | no |

### Semantic Nodes

#### Entity
A real-world entity mentioned in the report.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| entity_id | string | yes | Unique identifier |
| name | string | yes | Display name |
| canonical_name | string | no | Resolved canonical name |
| entity_type | string | yes | ORGANIZATION, PERSON, LOCATION, PRODUCT, INDUSTRY, EVENT, OTHER |
| description | string | no | Brief description |
| aliases | list | no | Alternative names |

#### Metric
A named metric type (e.g., "Revenue", "Gross Margin").

| Property | Type | Required |
|----------|------|----------|
| metric_id | string | yes |
| name | string | yes |
| unit | string | no |
| domain | string | no |

#### MetricValue
A specific measurement of a metric.

| Property | Type | Required |
|----------|------|----------|
| value_id | string | yes |
| value | float | yes |
| unit | string | no |
| period | string | no |
| context | string | no |

#### Claim
An assertion, opinion, or prediction extracted from the report.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| claim_id | string | yes | Unique identifier |
| text | string | yes | The claim text |
| claim_type | string | no | FACTUAL, OPINION, PREDICTION, COMPARISON, RECOMMENDATION |
| confidence | float | no | Extraction confidence (0-1) |
| polarity | string | no | Positive/negative sentiment |

#### TimePeriod
A time reference for metric values and claims.

| Property | Type | Required |
|----------|------|----------|
| period_id | string | yes |
| label | string | yes |
| start_date | string | no |
| end_date | string | no |

## Edge Types

### Document Structure Edges

| Edge | From | To | Description |
|------|------|----|-------------|
| HAS_SECTION | Report | Section | Report contains section |
| HAS_PARAGRAPH | Section | Paragraph | Section contains paragraph |
| PART_OF | Section | Section | Sub-section relationship |
| HAS_SPAN | Paragraph | SourceSpan | Paragraph has source span |

### Semantic Edges

| Edge | From | To | Description |
|------|------|----|-------------|
| MENTIONS | Paragraph, Claim | Entity | Text mentions entity |
| ASSERTS | Paragraph | Claim | Paragraph makes a claim |
| MEASURES | MetricValue | Metric | Value measures a metric type |
| HAS_VALUE | Entity | MetricValue | Entity has a metric value |
| REFERS_TO_PERIOD | MetricValue, Claim | TimePeriod | Time reference |
| ABOUT | Claim | Entity | Claim is about entity |

### Evidence Edges

| Edge | From | To | Description |
|------|------|----|-------------|
| SUPPORTED_BY | Claim, MetricValue | SourceSpan | Evidence source |
| DERIVED_FROM | MetricValue | SourceSpan | Data source |
| SOURCED_FROM | Entity | Report | Entity found in report |

### Resolution Edges

| Edge | From | To | Description |
|------|------|----|-------------|
| SAME_AS | Entity | Entity | Entity resolution link |

## Example Subgraph

For the text: *"2025 年公司云业务收入同比增长 42%，主要受企业客户需求提升推动。"*

```
(Report) -[HAS_SECTION]-> (Section: "Financial Analysis")
    -[HAS_PARAGRAPH]-> (Paragraph: "2025年公司云业务...")
        -[ASSERTS]-> (Claim: "增长主要受企业客户需求推动")
            -[ABOUT]-> (Entity: "公司云业务")
            -[SUPPORTED_BY]-> (SourceSpan: page=3, char=120-180)
        -[MENTIONS]-> (Entity: "企业客户需求")

(Entity: "公司云业务") -[HAS_VALUE]-> (MetricValue: 42%)
    -[MEASURES]-> (Metric: "收入增长率")
    -[REFERS_TO_PERIOD]-> (TimePeriod: "2025")
    -[SUPPORTED_BY]-> (SourceSpan: page=3, char=120-145)
```

## Schema Management

The ontology is defined in YAML files:
- `packages/core/src/insightgraph_core/ontology/nodes.yaml` - Node type definitions
- `packages/core/src/insightgraph_core/ontology/edges.yaml` - Edge type definitions

These are loaded at startup and used to:
1. Create Neo4j constraints and indexes
2. Validate extraction results
3. Generate agent tool descriptions
