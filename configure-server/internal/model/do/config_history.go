// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// ConfigHistory is the golang structure of table CONFIG_HISTORY for DAO operations like Where/Data.
type ConfigHistory struct {
	g.Meta     `orm:"table:CONFIG_HISTORY, do:true"`
	Id         interface{} //
	ConfigKey  interface{} //
	Version    interface{} //
	Content    interface{} //
	ActionType interface{} //
	Operator   interface{} //
	Remark     interface{} //
	CreatedAt  *gtime.Time //
}
