package v1

import "github.com/gogf/gf/v2/frame/g"

type RuntimeReq struct {
	g.Meta `path:"/config/runtime" method:"get" tags:"Config" summary:"每次请求从 g.Cfg 读取 test.shopName，用于验证 etcd 热更新"`
}

type RuntimeRes struct {
	ShopName    string   `json:"shopName" dc:"test.shopName，每次请求即时读取"`
	Test        any      `json:"test" dc:"test 整段"`
	Watch       bool     `json:"watch"`
	WatchShared bool     `json:"watchShared"`
	StickyKeys  []string `json:"stickyKeys" dc:"不参与热重载的根 key；为空表示全部 live"`
	ConfigFrom  string   `json:"configFrom" dc:"etcd | snapshot"`
	ReloadedAt  string   `json:"reloadedAt"`
	Changed     []string `json:"changed" dc:"最近一次热更新变更的配置路径"`
	EventKeys   []string `json:"eventKeys" dc:"触发本次热更新的 etcd key"`
}
