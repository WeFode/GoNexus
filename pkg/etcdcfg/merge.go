package etcdcfg

import (
	"strings"

	"github.com/gogf/gf/v2/encoding/gjson"
	"github.com/gogf/gf/v2/encoding/gyaml"
	"github.com/gogf/gf/v2/errors/gerror"
)

func asMap(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func deepMerge(dst, src map[string]any) map[string]any {
	if dst == nil {
		dst = make(map[string]any)
	}
	for k, v := range src {
		if srcMap, ok := asMap(v); ok {
			if dstMap, ok := asMap(dst[k]); ok {
				dst[k] = deepMerge(dstMap, srcMap)
				continue
			}
		}
		dst[k] = v
	}
	return dst
}

func deepCopyMap(src map[string]any) map[string]any {
	if src == nil {
		return nil
	}
	dst := make(map[string]any, len(src))
	for k, v := range src {
		dst[k] = deepCopyValue(v)
	}
	return dst
}

func deepCopyValue(v any) any {
	if m, ok := asMap(v); ok {
		return deepCopyMap(m)
	}
	return v
}

// applySticky 热重载时保留 sticky 根下的旧值；sticky 为空则全量采用 newMap。
func applySticky(oldMap, newMap map[string]any, stickyRoots []string) map[string]any {
	if len(stickyRoots) == 0 {
		return newMap
	}
	result := deepCopyMap(newMap)
	for _, root := range stickyRoots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		if oldVal, ok := oldMap[root]; ok {
			result[root] = deepCopyValue(oldVal)
		}
	}
	return result
}

func yamlToMap(content string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		return map[string]any{}, nil
	}
	j, err := gjson.LoadYaml([]byte(content))
	if err != nil {
		return nil, gerror.Wrap(err, "解析 YAML 失败")
	}
	m := j.Map()
	if m == nil {
		return nil, gerror.New("YAML 根节点必须是 map")
	}
	return m, nil
}

func mapToYAML(data map[string]any) (string, error) {
	if len(data) == 0 {
		return "", nil
	}
	b, err := gyaml.Encode(data)
	if err != nil {
		return "", gerror.Wrap(err, "编码 YAML 失败")
	}
	return string(b), nil
}

func rewriteLoopback(v any, as string) any {
	if strings.TrimSpace(as) == "" {
		return v
	}
	switch t := v.(type) {
	case string:
		return strings.ReplaceAll(t, "127.0.0.1", as)
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			out[k] = rewriteLoopback(val, as)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = rewriteLoopback(val, as)
		}
		return out
	default:
		return v
	}
}

func applyLoopback(m map[string]any, as string) map[string]any {
	if m == nil || strings.TrimSpace(as) == "" {
		return m
	}
	out, _ := rewriteLoopback(m, as).(map[string]any)
	return out
}

