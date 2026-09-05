// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// Products is the golang structure of table products for DAO operations like Where/Data.
type Products struct {
	g.Meta      `orm:"table:products, do:true"`
	Id          any         //
	Name        any         // 商品名称
	Description any         // 商品描述
	Price       any         // 价格
	Stock       any         // 库存
	Status      any         // 状态：1上架 0下架
	CreatedAt   *gtime.Time //
	UpdatedAt   *gtime.Time //
}
