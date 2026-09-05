package service

import (
	"context"

	v1 "shop-server/api/product/v1"
)

type IProduct interface {
	Create(ctx context.Context, req *v1.CreateReq) (*v1.CreateRes, error)
	Get(ctx context.Context, id int64) (*v1.GetRes, error)
	List(ctx context.Context, req *v1.ListReq) (*v1.ListRes, error)
	Update(ctx context.Context, req *v1.UpdateReq) error
	Delete(ctx context.Context, id int64) error
}

var localProduct IProduct

func Product() IProduct {
	if localProduct == nil {
		panic("implement not found for interface IProduct, forgot register?")
	}
	return localProduct
}

func RegisterProduct(i IProduct) {
	localProduct = i
}
