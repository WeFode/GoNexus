package etcdcfg

import "strings"

const (
	// DefaultPrefix 是配置中心在 etcd 中的根路径。
	DefaultPrefix = "/config-center"
	// kindShared 是共享配置的类型
	kindShared = "shared"
	// kindServices 是服务配置的类型
	kindServices = "services"
)

// normalizePrefix 规范化配置前缀，确保以 / 开头且没有多余的 /
func normalizePrefix(prefix string) string {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return DefaultPrefix
	}
	if !strings.HasPrefix(prefix, "/") {
		prefix = "/" + prefix
	}
	return strings.TrimRight(prefix, "/")
}

func SharedPrefix(prefix string) string {
	return normalizePrefix(prefix) + "/" + kindShared + "/"
}

func ServicePrefix(prefix string) string {
	return normalizePrefix(prefix) + "/" + kindServices + "/"
}

func SharedKey(prefix, name string) string {
	return SharedPrefix(prefix) + strings.Trim(name, "/")
}

func ServiceKey(prefix, name string) string {
	return ServicePrefix(prefix) + strings.Trim(name, "/")
}

func nameFromKey(prefixWithSlash, fullKey string) string {
	return strings.TrimPrefix(fullKey, prefixWithSlash)
}
