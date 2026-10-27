package v1

import "github.com/gogf/gf/v2/frame/g"

type ProductItem struct {
	Id          int64   `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Price       float64 `json:"price"`
	Stock       int     `json:"stock"`
	Status      int     `json:"status" dc:"1=上架 0=下架"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

type CreateReq struct {
	g.Meta      `path:"/products" method:"post" tags:"Product" summary:"创建商品"`
	Name        string  `json:"name" v:"required|length:1,128#请输入商品名称|名称长度1-128" dc:"商品名称"`
	Description string  `json:"description" dc:"商品描述"`
	Price       float64 `json:"price" v:"min:0#价格不能为负" dc:"价格"`
	Stock       int     `json:"stock" v:"min:0#库存不能为负" dc:"库存"`
	Status      int     `json:"status" d:"1" v:"in:0,1#状态只能是0或1" dc:"1=上架 0=下架"`
}

type CreateRes struct {
	Id int64 `json:"id"`
}

type GetReq struct {
	g.Meta `path:"/products/{id}" method:"get" tags:"Product" summary:"商品详情"`
	Id     int64 `path:"id" v:"required|min:1#商品ID无效"`
}

type GetRes struct {
	ProductItem
}

type ListReq struct {
	g.Meta `path:"/products" method:"get" tags:"Product" summary:"商品列表"`
	Page   int    `json:"page" d:"1" v:"min:1" dc:"页码"`
	Size   int    `json:"size" d:"20" v:"min:1|max:100" dc:"每页条数"`
	Name   string `json:"name" dc:"按名称模糊搜索"`
	Status *int   `json:"status" dc:"按状态筛选：1上架 0下架"`
}

type ListRes struct {
	Total int           `json:"total"`
	Page  int           `json:"page"`
	Size  int           `json:"size"`
	List  []ProductItem `json:"list"`
}

type UpdateReq struct {
	g.Meta      `path:"/products/{id}" method:"put" tags:"Product" summary:"更新商品"`
	Id          int64    `path:"id" v:"required|min:1#商品ID无效"`
	Name        *string  `json:"name" v:"length:1,128#名称长度1-128" dc:"商品名称"`
	Description *string  `json:"description" dc:"商品描述"`
	Price       *float64 `json:"price" v:"min:0#价格不能为负" dc:"价格"`
	Stock       *int     `json:"stock" v:"min:0#库存不能为负" dc:"库存"`
	Status      *int     `json:"status" v:"in:0,1#状态只能是0或1" dc:"1=上架 0=下架"`
}

type UpdateRes struct{}

type DeleteReq struct {
	g.Meta `path:"/products/{id}" method:"delete" tags:"Product" summary:"删除商品"`
	Id     int64 `path:"id" v:"required|min:1#商品ID无效"`
}

type DeleteRes struct{}
