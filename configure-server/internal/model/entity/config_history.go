// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// ConfigHistory is the golang structure for table CONFIG_HISTORY.
type ConfigHistory struct {
	Id         int64       `json:"id"          orm:"ID"          description:""` //
	ConfigKey  string      `json:"config_key"  orm:"CONFIG_KEY"  description:""` //
	Version    int         `json:"version"     orm:"VERSION"     description:""` //
	Content    string      `json:"content"     orm:"CONTENT"     description:""` //
	ActionType string      `json:"action_type" orm:"ACTION_TYPE" description:""` //
	Operator   string      `json:"operator"    orm:"OPERATOR"    description:""` //
	Remark     string      `json:"remark"      orm:"REMARK"      description:""` //
	CreatedAt  *gtime.Time `json:"created_at"  orm:"CREATED_AT"  description:""` //
}
