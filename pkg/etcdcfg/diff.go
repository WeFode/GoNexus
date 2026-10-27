package etcdcfg

import (
	"fmt"
	"sort"
	"strings"
)

func flatten(prefix string, v any, out map[string]string) {
	if m, ok := asMap(v); ok {
		for k, val := range m {
			next := k
			if prefix != "" {
				next = prefix + "." + k
			}
			flatten(next, val, out)
		}
		return
	}
	if prefix == "" {
		return
	}
	if v == nil {
		out[prefix] = ""
		return
	}
	out[prefix] = fmt.Sprint(v)
}

func changedKeys(oldMap, newMap map[string]any) []string {
	oldFlat, newFlat := map[string]string{}, map[string]string{}
	flatten("", oldMap, oldFlat)
	flatten("", newMap, newFlat)
	var keys []string
	for k, v := range newFlat {
		if oldFlat[k] != v {
			keys = append(keys, k)
		}
	}
	for k := range oldFlat {
		if _, ok := newFlat[k]; !ok {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

func rootKey(pattern string) string {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return ""
	}
	if i := strings.Index(pattern, "."); i >= 0 {
		return pattern[:i]
	}
	return pattern
}

func matchRoots(pattern string, roots []string) bool {
	root := rootKey(pattern)
	if root == "" {
		return false
	}
	for _, r := range roots {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		if root == r || strings.HasPrefix(pattern, r+".") {
			return true
		}
	}
	return false
}

func splitChanged(changed, sticky []string) (live, stickyHit []string) {
	if len(sticky) == 0 {
		return changed, nil
	}
	for _, k := range changed {
		if matchRoots(k, sticky) {
			stickyHit = append(stickyHit, k)
		} else {
			live = append(live, k)
		}
	}
	return
}

// sharedConfigName 从 etcd shared key 解析配置名，如 /config-center/shared/database → database。
func sharedConfigName(prefix, fullKey string) (string, bool) {
	sharedPrefix := SharedPrefix(prefix)
	if !strings.HasPrefix(fullKey, sharedPrefix) {
		return "", false
	}
	name := strings.TrimPrefix(fullKey, sharedPrefix)
	if name == "" || strings.Contains(name, "/") {
		return "", false
	}
	return name, true
}

// shouldSkipReload 仅当所有 etcd 事件都只涉及 sticky 的 shared 配置时跳过拉取（性能优化）。
func shouldSkipReload(eventKeys []string, sticky []string, prefix, service string) bool {
	if len(sticky) == 0 || len(eventKeys) == 0 {
		return false
	}
	serviceKey := ServiceKey(prefix, service)
	for _, ek := range eventKeys {
		if ek == serviceKey {
			return false
		}
		name, ok := sharedConfigName(prefix, ek)
		if !ok {
			return false
		}
		if !matchRoots(name, sticky) {
			return false
		}
	}
	return true
}
