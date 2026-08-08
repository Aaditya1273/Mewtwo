package datahub

import (
	"encoding/json"
	"regexp"
	"strings"
)

// --- helpers ---

// extractJSON walks a raw text block and returns the first JSON object or array
// found. This handles markdown-fenced responses and prose-wrapped JSON that
// some MCP servers emit.
func extractJSON(text string) (json.RawMessage, bool) {
	s := strings.TrimSpace(text)
	// strip markdown fences
	if strings.HasPrefix(s, "```") {
		if idx := strings.Index(s, "\n"); idx != -1 {
			s = s[idx+1:]
		}
		s = strings.TrimSuffix(s, "```")
	}

	start := -1
	for i := 0; i < len(s); i++ {
		if s[i] == '{' || s[i] == '[' {
			start = i
			break
		}
	}
	if start == -1 {
		return nil, false
	}

	// find the matching closing bracket, respecting strings
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(s); i++ {
		ch := s[i]
		if inString {
			if escaped {
				escaped = false
			} else if ch == '\\' {
				escaped = true
			} else if ch == '"' {
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{', '[':
			depth++
		case '}', ']':
			depth--
			if depth == 0 {
				return json.RawMessage(s[start : i+1]), true
			}
		}
	}
	return nil, false
}

// asStrings normalizes any of the tag representations DataHub uses:
// ["PII"], [{"name":"PII"}], [{"tag":{"name":"PII"}}],
// [{"tag":{"properties":{"name":"PII"}}}], "PII", "urn:li:tag:PII".
func asStrings(v any) []string {
	var out []string
	switch t := v.(type) {
	case string:
		out = append(out, t)
	case []any:
		for _, item := range t {
			out = append(out, asStrings(item)...)
		}
	case map[string]any:
		for _, key := range []string{"name", "tag", "value", "urn", "displayName"} {
			if s, ok := t[key].(string); ok && s != "" {
				out = append(out, s)
			}
		}
		// nested shapes: {"tags": [{"tag": {"name": "PII"}}]},
		// {"tag": {"name": "PII"}} and the real DataHub shape
		// {"tag": {"properties": {"name": "PII"}}}
		if inner, ok := t["tags"]; ok {
			out = append(out, asStrings(inner)...)
		}
		if inner, ok := t["tag"].(map[string]any); ok {
			if s, ok := inner["name"].(string); ok {
				out = append(out, s)
			}
			if props, ok := inner["properties"].(map[string]any); ok {
				if s, ok := props["name"].(string); ok {
					out = append(out, s)
				}
			}
		}
		if inner, ok := t["entity"].(map[string]any); ok {
			if s, ok := inner["name"].(string); ok {
				out = append(out, s)
			}
		}
	}
	return dedupe(out)
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// shortName strips a URN prefix to its readable tail (e.g. "urn:li:tag:PII" → "PII").
func shortName(s string) string {
	if idx := strings.LastIndex(s, ":"); idx != -1 {
		return s[idx+1:]
	}
	return s
}

// --- tag scanning ---

var tagRe = regexp.MustCompile(`(?i)(?:tag|glossaryTerm|term)[^\w]*[:=][^\w]*([A-Za-z0-9_\-\.]+)`)

// tagsFromText is the keyword fallback: it scans raw text for tag-like tokens
// ("tag:PII", "urn:li:tag:PII", "Tags: PII") so governance still works even
// when the payload is not valid JSON.
func tagsFromText(text string) []string {
	var out []string
	for _, m := range tagRe.FindAllStringSubmatch(text, -1) {
		if len(m) > 1 {
			out = append(out, m[1])
		}
	}
	// also catch "Tags: PII, Sensitive" and plain inline mentions of known tags
	for _, known := range []string{"PII", "Sensitive", "GDPR", "HIPAA", "PHI", "Deprecated", "deprecated"} {
		if strings.Contains(text, known) {
			out = append(out, known)
		}
	}
	return dedupe(out)
}

// hasTag reports whether the tag list (or raw text) mentions any of the wanted
// tags, compared case-insensitively on the readable tail.
func hasTag(tags []string, text string, wanted ...string) bool {
	for _, t := range tags {
		short := strings.ToLower(shortName(t))
		for _, w := range wanted {
			if short == strings.ToLower(w) {
				return true
			}
		}
	}
	lower := strings.ToLower(text)
	for _, w := range wanted {
		wl := strings.ToLower(w)
		if strings.Contains(lower, "tag:"+wl) || strings.Contains(lower, "urn:li:tag:"+wl) {
			return true
		}
	}
	return false
}

// --- parsers ---

// ParseAsset builds an Asset from a get_entities / search response block.
// urn is the expected URN (used as a fallback for the asset identity).
func ParseAsset(text string, urn string) *Asset {
	asset := &Asset{URN: urn}

	if raw, ok := extractJSON(text); ok {
		var root any
		if err := json.Unmarshal(raw, &root); err == nil {
			if arr, ok := root.([]any); ok && len(arr) > 0 {
				root = arr[0]
			}
			// unwrap result/entity wrappers
			if m, ok := root.(map[string]any); ok {
				for _, key := range []string{"result", "entity", "entities", "data", "asset"} {
					if inner, ok := m[key]; ok {
						if im, ok := inner.(map[string]any); ok {
							root = im
							break
						}
						if arr, ok := inner.([]any); ok && len(arr) > 0 {
							if im, ok := arr[0].(map[string]any); ok {
								root = im
								break
							}
						}
					}
				}
			}
			asset = walkAsset(root)
			if asset.URN == "" {
				asset.URN = urn
			}
		}
	}

	// text fallback: pull any urn:li:... token out
	if asset.URN == "" || asset.URN == urn {
		if found := findURN(text); found != "" {
			asset.URN = found
		}
	}
	asset.Tags = dedupe(append(asset.Tags, tagsFromText(text)...))
	return asset
}

// unwrapEntity digs through the wrappers the real DataHub MCP server emits:
// search results come back as {"searchResults": [{"entity": {...}}]} and
// lineage as {"upstreams": {"searchResults": [{"entity": {...}}]}}. This
// helper normalizes any of those shapes down to the underlying entity map.
func unwrapEntity(v any) any {
	m, ok := v.(map[string]any)
	if !ok {
		return v
	}
	// direct entity wrapper: {"entity": {...}}
	if e, ok := m["entity"]; ok {
		if _, isMap := e.(map[string]any); isMap {
			return e
		}
	}
	// searchResults wrapper: {"searchResults": [{"entity": {...}}]}
	if sr, ok := m["searchResults"].([]any); ok && len(sr) > 0 {
		return sr[0]
	}
	if sr, ok := m["searchResults"].([]any); ok && len(sr) == 0 {
		return nil
	}
	return v
}

// walkAsset maps a decoded JSON value onto an Asset struct using the common
// DataHub response shapes.
func walkAsset(root any) *Asset {
	asset := &Asset{}
	m, ok := root.(map[string]any)
	if !ok {
		return asset
	}

	for _, key := range []string{"urn", "id"} {
		if s, ok := m[key].(string); ok {
			asset.URN = s
			break
		}
	}
	if s, ok := m["name"].(string); ok {
		asset.Name = s
	}
	if s, ok := m["displayName"].(string); ok {
		asset.Name = s
	}
	// real DataHub shape nests name/description under properties
	if props, ok := m["properties"].(map[string]any); ok {
		if s, ok := props["name"].(string); ok && s != "" {
			asset.Name = s
		}
		if s, ok := props["description"].(string); ok && s != "" {
			asset.Description = s
		}
	}
	if s, ok := m["type"].(string); ok {
		asset.Type = s
	}
	if s, ok := m["description"].(string); ok {
		asset.Description = s
	}
	if s, ok := m["platform"].(string); ok {
		asset.Platform = s
	}
	if s, ok := m["dataPlatform"].(string); ok {
		asset.Platform = s
	}
	// real shape: platform is an object {"name": "snowflake", ...}
	if plat, ok := m["platform"].(map[string]any); ok {
		if s, ok := plat["name"].(string); ok && s != "" {
			asset.Platform = s
		}
		if props, ok := plat["properties"].(map[string]any); ok {
			if s, ok := props["displayName"].(string); ok && s != "" {
				asset.Platform = s
			}
		}
	}
	if b, ok := m["deprecated"].(bool); ok {
		asset.Deprecated = b
	}
	if dep, ok := m["deprecation"].(map[string]any); ok {
		if b, ok := dep["deprecated"].(bool); ok {
			asset.Deprecated = b
		}
	}

	// tags — several shapes: globalTags, tags, tag
	for _, key := range []string{"globalTags", "tags", "tag"} {
		if v, ok := m[key]; ok {
			asset.Tags = append(asset.Tags, asStrings(v)...)
		}
	}
	// real shape: globalTags.tags[].tag.properties.name (and legacy tag.name)
	if gt, ok := m["globalTags"].(map[string]any); ok {
		if arr, ok := gt["tags"].([]any); ok {
			for _, item := range arr {
				if im, ok := item.(map[string]any); ok {
					if tag, ok := im["tag"].(map[string]any); ok {
						if name, ok := tag["name"].(string); ok {
							asset.Tags = append(asset.Tags, name)
						}
						if props, ok := tag["properties"].(map[string]any); ok {
							if name, ok := props["name"].(string); ok {
								asset.Tags = append(asset.Tags, name)
							}
						}
					}
				}
			}
		}
	}
	// glossary terms
	for _, key := range []string{"glossaryTerms", "terms"} {
		if v, ok := m[key]; ok {
			asset.GlossaryTerms = append(asset.GlossaryTerms, asStrings(v)...)
		}
	}

	// ownership — real shape: ownership.owners[].owner.urn (+displayName)
	if own, ok := m["ownership"].(map[string]any); ok {
		if owners, ok := own["owners"].([]any); ok {
			for _, o := range owners {
				if om, ok := o.(map[string]any); ok {
					if owner, ok := om["owner"].(map[string]any); ok {
						if urn, ok := owner["urn"].(string); ok {
							asset.Owners = append(asset.Owners, urn)
						}
						if props, ok := owner["properties"].(map[string]any); ok {
							if dn, ok := props["displayName"].(string); ok && dn != "" {
								asset.Owners = append(asset.Owners, dn)
							}
						}
					}
				}
			}
		}
	}

	// data quality
	if dq, ok := m["dataQuality"].(map[string]any); ok {
		if score, ok := dq["score"].(float64); ok {
			asset.QualityScore = &score
		}
	}
	if dq, ok := m["dataQuality"].(map[string]any); ok {
		if health, ok := dq["healthScore"].(float64); ok {
			asset.QualityScore = &health
		}
	}

	return asset
}

// findURN extracts the first urn:li:... token from raw text.
func findURN(text string) string {
	idx := strings.Index(text, "urn:li:")
	if idx == -1 {
		return ""
	}
	rest := text[idx:]
	end := strings.IndexAny(rest, " \t\n\r\"',)]}")
	if end == -1 {
		return rest
	}
	return rest[:end]
}

// ParseAssets parses a search response into a list of assets. The real DataHub
// MCP server returns {"searchResults": [{"entity": {...}}, ...]} — both the
// searchResults wrapper and the entity wrapper are handled here, along with
// simpler {results:[...]} and bare-array shapes.
func ParseAssets(text string) []Asset {
	var assets []Asset
	if raw, ok := extractJSON(text); ok {
		var root any
		if err := json.Unmarshal(raw, &root); err == nil {
			if m, ok := root.(map[string]any); ok {
				// real shape: searchResults[].entity
				if sr, ok := m["searchResults"].([]any); ok {
					for _, item := range sr {
						if a := walkAsset(unwrapEntity(item)); a.URN != "" {
							assets = append(assets, *a)
						}
					}
				}
				// fallback keys: results / entities / data / items
				if len(assets) == 0 {
					for _, key := range []string{"results", "entities", "data", "items"} {
						if arr, ok := m[key].([]any); ok {
							for _, item := range arr {
								if a := walkAsset(unwrapEntity(item)); a.URN != "" {
									assets = append(assets, *a)
								}
							}
							break
						}
					}
				}
				if len(assets) == 0 {
					// single asset wrapped
					if a := walkAsset(unwrapEntity(m)); a.URN != "" {
						assets = append(assets, *a)
					}
				}
			} else if arr, ok := root.([]any); ok {
				for _, item := range arr {
					assets = append(assets, *walkAsset(unwrapEntity(item)))
				}
			}
		}
	}
	if len(assets) == 0 {
		// text fallback: extract every urn:li token
		seen := map[string]bool{}
		for _, urn := range findAllURNs(text) {
			if !seen[urn] {
				seen[urn] = true
				assets = append(assets, Asset{URN: urn})
			}
		}
	}
	for i := range assets {
		assets[i].Tags = dedupe(append(assets[i].Tags, tagsFromText(text)...))
	}
	return assets
}

func findAllURNs(text string) []string {
	var out []string
	rest := text
	for {
		idx := strings.Index(rest, "urn:li:")
		if idx == -1 {
			break
		}
		rest = rest[idx:]
		end := strings.IndexAny(rest, " \t\n\r\"',)]}")
		if end == -1 {
			out = append(out, rest)
			break
		}
		out = append(out, rest[:end])
		rest = rest[end:]
	}
	return dedupe(out)
}

// ParseLineage parses a get_lineage response into a graph. The real DataHub
// MCP server returns {"upstreams": {"searchResults": [{"entity": {...}}]},
// "downstreams": {...}} — those wrappers are handled here along with simpler
// {upstream:[...]}/{downstream:[...]} shapes.
func ParseLineage(text, rootURN, direction string) *LineageGraph {
	graph := &LineageGraph{RootURN: rootURN, Direction: direction}

	if raw, ok := extractJSON(text); ok {
		var root any
		if err := json.Unmarshal(raw, &root); err == nil {
			if m, ok := root.(map[string]any); ok {
				for _, key := range []string{"result", "data", "lineage"} {
					if inner, ok := m[key].(map[string]any); ok {
						m = inner
						break
					}
				}
				// real shape: upstreams/downstreams -> searchResults -> entity
				if up, ok := m["upstreams"]; ok {
					graph.Upstream = parseLineageSearchResults(up)
				}
				if down, ok := m["downstreams"]; ok {
					graph.Downstream = parseLineageSearchResults(down)
				}
				if len(graph.Upstream) == 0 && len(graph.Downstream) == 0 {
					if up, ok := m["upstream"].([]any); ok {
						graph.Upstream = parseNodes(up)
					}
					if down, ok := m["downstream"].([]any); ok {
						graph.Downstream = parseNodes(down)
					}
				}
				// some shapes use "entities" with a direction field
				if ents, ok := m["entities"].([]any); ok {
					nodes := parseNodes(ents)
					if direction == "DOWNSTREAM" {
						graph.Downstream = append(graph.Downstream, nodes...)
					} else {
						graph.Upstream = append(graph.Upstream, nodes...)
					}
				}
			}
		}
	}

	// text fallback: treat every urn in the block as a node in the requested direction
	if len(graph.Upstream) == 0 && len(graph.Downstream) == 0 {
		for _, urn := range findAllURNs(text) {
			if urn == rootURN {
				continue
			}
			node := &LineageNode{URN: urn, Tags: tagsFromText(text)}
			if direction == "DOWNSTREAM" {
				graph.Downstream = append(graph.Downstream, node)
			} else {
				graph.Upstream = append(graph.Upstream, node)
			}
		}
	}
	return graph
}

// parseLineageSearchResults extracts entities from a lineage direction block:
// {"searchResults": [{"entity": {...}}, ...]}
func parseLineageSearchResults(v any) []*LineageNode {
	dir, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	sr, ok := dir["searchResults"].([]any)
	if !ok {
		return nil
	}
	var nodes []*LineageNode
	for _, item := range sr {
		nodes = append(nodes, parseNode(unwrapEntity(item)))
	}
	return nodes
}

func parseNodes(items []any) []*LineageNode {
	var nodes []*LineageNode
	for _, item := range items {
		nodes = append(nodes, parseNode(item))
	}
	return nodes
}

func parseNode(item any) *LineageNode {
	m, ok := item.(map[string]any)
	if !ok {
		return &LineageNode{}
	}
	node := &LineageNode{}
	for _, key := range []string{"urn", "id"} {
		if s, ok := m[key].(string); ok {
			node.URN = s
			break
		}
	}
	if s, ok := m["type"].(string); ok {
		node.Type = s
	}
	if s, ok := m["name"].(string); ok {
		node.Name = s
	}
	if props, ok := m["properties"].(map[string]any); ok {
		if s, ok := props["name"].(string); ok && s != "" {
			node.Name = s
		}
	}
	if s, ok := m["platform"].(string); ok {
		node.Platform = s
	}
	if plat, ok := m["platform"].(map[string]any); ok {
		if s, ok := plat["name"].(string); ok && s != "" {
			node.Platform = s
		}
	}
	for _, key := range []string{"globalTags", "tags"} {
		if v, ok := m[key]; ok {
			node.Tags = append(node.Tags, asStrings(v)...)
		}
	}
	// nested lineage (multi-hop)
	if up, ok := m["upstream"].([]any); ok {
		node.Upstream = parseNodes(up)
	}
	if down, ok := m["downstream"].([]any); ok {
		node.Downstream = parseNodes(down)
	}
	return node
}

// ParseSchemaFields parses a list_schema_fields response.
func ParseSchemaFields(text string) []SchemaField {
	var fields []SchemaField
	if raw, ok := extractJSON(text); ok {
		var root any
		if err := json.Unmarshal(raw, &root); err == nil {
			if m, ok := root.(map[string]any); ok {
				for _, key := range []string{"fields", "schemaFields", "result"} {
					if inner, ok := m[key]; ok {
						if arr, ok := inner.([]any); ok {
							root = arr
							break
						}
					}
				}
			}
			if arr, ok := root.([]any); ok {
				for _, item := range arr {
					if fm, ok := item.(map[string]any); ok {
						f := SchemaField{}
						if s, ok := fm["fieldPath"].(string); ok {
							f.FieldPath = s
						}
						if s, ok := fm["type"].(string); ok {
							f.Type = s
						}
						if s, ok := fm["nativeDataType"].(string); ok {
							f.Type = s
						}
						if s, ok := fm["description"].(string); ok {
							f.Description = s
						}
						// real shape: cleaned fields carry plain string tag arrays
						if v, ok := fm["tags"]; ok {
							f.Tags = append(f.Tags, asStrings(v)...)
						}
						if v, ok := fm["globalTags"]; ok {
							f.Tags = append(f.Tags, asStrings(v)...)
						}
						fields = append(fields, f)
					}
				}
			}
		}
	}
	return fields
}

// FlattenLineageTags collects every tag found anywhere in the lineage graph
// (recursively, upstream and downstream) so governance plugins can scan for
// sensitive markers across the full impact surface.
func (g *LineageGraph) FlattenLineageTags() []string {
	if g == nil {
		return nil
	}
	var tags []string
	var walk func(nodes []*LineageNode)
	walk = func(nodes []*LineageNode) {
		for _, n := range nodes {
			if n == nil {
				continue
			}
			tags = append(tags, n.Tags...)
			walk(n.Upstream)
			walk(n.Downstream)
		}
	}
	walk(g.Upstream)
	walk(g.Downstream)
	return dedupe(tags)
}
