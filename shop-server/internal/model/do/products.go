// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package do

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
)

// Products is the golang structure of table PRODUCTS for DAO operations like Where/Data.
type Products struct {
	g.Meta      `orm:"table:PRODUCTS, do:true"`
	Id          interface{} //
	Name        interface{} //
	Description interface{} //
	Price       interface{} //
	Stock       interface{} //
	Status      interface{} //
	CreatedAt   *gtime.Time //
	UpdatedAt   *gtime.Time //
}
