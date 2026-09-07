// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package entity

import (
	"github.com/gogf/gf/v2/os/gtime"
)

// Products is the golang structure for table PRODUCTS.
type Products struct {
	Id          int64       `json:"id"          orm:"ID"          description:""` //
	Name        string      `json:"name"        orm:"NAME"        description:""` //
	Description string      `json:"description" orm:"DESCRIPTION" description:""` //
	Price       float64     `json:"price"       orm:"PRICE"       description:""` //
	Stock       int         `json:"stock"       orm:"STOCK"       description:""` //
	Status      int         `json:"status"      orm:"STATUS"      description:""` //
	CreatedAt   *gtime.Time `json:"created_at"  orm:"CREATED_AT"  description:""` //
	UpdatedAt   *gtime.Time `json:"updated_at"  orm:"UPDATED_AT"  description:""` //
}
