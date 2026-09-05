// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// Products is the golang structure for table products.
type Products struct {
	Id          int64       `json:"id"          orm:"id"          description:""`           //
	Name        string      `json:"name"        orm:"name"        description:"商品名称"`       // 商品名称
	Description string      `json:"description" orm:"description" description:"商品描述"`       // 商品描述
	Price       float64     `json:"price"       orm:"price"       description:"价格"`         // 价格
	Stock       int         `json:"stock"       orm:"stock"       description:"库存"`         // 库存
	Status      int         `json:"status"      orm:"status"      description:"状态：1上架 0下架"` // 状态：1上架 0下架
	CreatedAt   *gtime.Time `json:"createdAt"   orm:"created_at"  description:""`           //
	UpdatedAt   *gtime.Time `json:"updatedAt"   orm:"updated_at"  description:""`           //
}
