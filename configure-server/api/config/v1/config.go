package v1

import "github.com/gogf/gf/v2/frame/g"

type ConfigItem struct {
	Key      string `json:"key"`
	FullKey  string `json:"fullKey"`
	Content  string `json:"content" dc:"YAML 文本"`
	Revision int64  `json:"revision"`
}

type ListSharedReq struct {
	g.Meta `path:"/configs/shared" method:"get" tags:"Config" summary:"公共配置列表"`
}

type ListSharedRes struct {
	List []ConfigItem `json:"list"`
}

type GetSharedReq struct {
	g.Meta `path:"/configs/shared/{key}" method:"get" tags:"Config" summary:"读取公共配置"`
	Key    string `path:"key" v:"required#配置名不能为空" dc:"如 database、redis"`
}

type GetSharedRes struct {
	ConfigItem
}

type PutSharedReq struct {
	g.Meta   `path:"/configs/shared/{key}" method:"put" tags:"Config" summary:"写入公共配置"`
	Key      string `path:"key" v:"required#配置名不能为空"`
	Content  string `json:"content" v:"required#YAML 内容不能为空" dc:"YAML，将与各服务配置合并"`
	Operator string `json:"operator" dc:"操作人，未登录时可手填"`
	Remark   string `json:"remark" dc:"变更说明"`
}

type PutSharedRes struct{}

type DeleteSharedReq struct {
	g.Meta   `path:"/configs/shared/{key}" method:"delete" tags:"Config" summary:"删除公共配置"`
	Key      string `path:"key" v:"required#配置名不能为空"`
	Operator string `json:"operator"`
	Remark   string `json:"remark"`
}

type DeleteSharedRes struct{}

type ListServicesReq struct {
	g.Meta `path:"/configs/services" method:"get" tags:"Config" summary:"服务配置列表"`
}

type ListServicesRes struct {
	List []ConfigItem `json:"list"`
}

type GetServiceReq struct {
	g.Meta `path:"/configs/services/{name}" method:"get" tags:"Config" summary:"读取服务配置"`
	Name   string `path:"name" v:"required#服务名不能为空" dc:"如 shop-server"`
}

type GetServiceRes struct {
	ConfigItem
}

type PutServiceReq struct {
	g.Meta   `path:"/configs/services/{name}" method:"put" tags:"Config" summary:"写入服务配置"`
	Name     string `path:"name" v:"required#服务名不能为空"`
	Content  string `json:"content" v:"required#YAML 内容不能为空" dc:"服务专属 YAML，可覆盖公共配置"`
	Operator string `json:"operator"`
	Remark   string `json:"remark"`
}

type PutServiceRes struct{}

type DeleteServiceReq struct {
	g.Meta   `path:"/configs/services/{name}" method:"delete" tags:"Config" summary:"删除服务配置"`
	Name     string `path:"name" v:"required#服务名不能为空"`
	Operator string `json:"operator"`
	Remark   string `json:"remark"`
}

type DeleteServiceRes struct{}

type PreviewReq struct {
	g.Meta `path:"/configs/preview/{name}" method:"get" tags:"Config" summary:"预览服务合并后的完整配置"`
	Name   string `path:"name" v:"required#服务名不能为空"`
}

type PreviewRes struct {
	Name    string `json:"name"`
	Content string `json:"content" dc:"shared + 服务配置合并后的 YAML"`
}

type SeedReq struct {
	g.Meta   `path:"/configs/seed" method:"post" tags:"Config" summary:"将本地 seed 目录写入 etcd"`
	Force    bool   `json:"force" dc:"true 则覆盖已有 key；默认只写入缺失项"`
	Dir      string `json:"dir" dc:"默认 manifest/etcd-seed"`
	Operator string `json:"operator"`
	Remark   string `json:"remark"`
}

type SeedRes struct {
	Written int `json:"written"`
}

type HistoryItem struct {
	Id         int64  `json:"id"`
	ConfigKey  string `json:"configKey"`
	Version    int    `json:"version"`
	Content    string `json:"content"`
	ActionType string `json:"actionType"`
	Operator   string `json:"operator"`
	Remark     string `json:"remark"`
	CreatedAt  string `json:"createdAt"`
}

type ListHistoryReq struct {
	g.Meta `path:"/configs/history/{kind}/{key}" method:"get" tags:"Config" summary:"配置变更历史"`
	Kind   string `path:"kind" v:"required|in:shared,services#kind 只能是 shared 或 services"`
	Key    string `path:"key" v:"required#配置名不能为空"`
}

type ListHistoryRes struct {
	List []HistoryItem `json:"list"`
}

type RollbackReq struct {
	g.Meta   `path:"/configs/rollback" method:"post" tags:"Config" summary:"回滚到历史版本（发布新版本）"`
	Kind     string `json:"kind" v:"required|in:shared,services"`
	Key      string `json:"key" v:"required#配置名不能为空"`
	Version  int    `json:"version" v:"required|min:1"`
	Operator string `json:"operator"`
	Remark   string `json:"remark"`
}

type RollbackRes struct {
	Version int `json:"version" dc:"回滚后的新版本号"`
}
