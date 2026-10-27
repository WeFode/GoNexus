package etcdcfg

import (
	"strings"

	"github.com/gogf/gf/v2/errors/gerror"
)

// ParsedHost 解析自 svc.etcd.host。
//
// 格式：
//
//	<endpoints>@<serviceName>
//
// endpoints 支持逗号分隔的多个地址。服务名用于拉取 /config-center/services/{name}。
// 配置中心自身可以只写 endpoints，不带 @serviceName。
//
// 示例：
//
//	127.0.0.1:2379@shop-server
//	127.0.0.1:2379,127.0.0.1:2479@shop-server
//	127.0.0.1:2379
type ParsedHost struct {
	Endpoints   []string
	ServiceName string
}

func ParseHost(host string) (ParsedHost, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return ParsedHost{}, gerror.New("svc.etcd.host 不能为空")
	}

	endpointsPart := host
	service := ""
	if i := strings.LastIndex(host, "@"); i >= 0 {
		endpointsPart = strings.TrimSpace(host[:i])
		service = strings.TrimSpace(host[i+1:])
	}
	if endpointsPart == "" {
		return ParsedHost{}, gerror.New("etcd 地址不能为空，格式为 ip:port@服务名")
	}

	var endpoints []string
	for _, e := range strings.Split(endpointsPart, ",") {
		e = strings.TrimSpace(e)
		if e != "" {
			endpoints = append(endpoints, e)
		}
	}
	if len(endpoints) == 0 {
		return ParsedHost{}, gerror.New("未解析到 etcd 地址")
	}
	return ParsedHost{Endpoints: endpoints, ServiceName: service}, nil
}
