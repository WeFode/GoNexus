// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package config

import (
	"context"

	"configure-server/api/config/v1"
)

type IConfigV1 interface {
	ListShared(ctx context.Context, req *v1.ListSharedReq) (res *v1.ListSharedRes, err error)
	GetShared(ctx context.Context, req *v1.GetSharedReq) (res *v1.GetSharedRes, err error)
	PutShared(ctx context.Context, req *v1.PutSharedReq) (res *v1.PutSharedRes, err error)
	DeleteShared(ctx context.Context, req *v1.DeleteSharedReq) (res *v1.DeleteSharedRes, err error)
	ListServices(ctx context.Context, req *v1.ListServicesReq) (res *v1.ListServicesRes, err error)
	GetService(ctx context.Context, req *v1.GetServiceReq) (res *v1.GetServiceRes, err error)
	PutService(ctx context.Context, req *v1.PutServiceReq) (res *v1.PutServiceRes, err error)
	DeleteService(ctx context.Context, req *v1.DeleteServiceReq) (res *v1.DeleteServiceRes, err error)
	Preview(ctx context.Context, req *v1.PreviewReq) (res *v1.PreviewRes, err error)
	Seed(ctx context.Context, req *v1.SeedReq) (res *v1.SeedRes, err error)
	ListHistory(ctx context.Context, req *v1.ListHistoryReq) (res *v1.ListHistoryRes, err error)
	Rollback(ctx context.Context, req *v1.RollbackReq) (res *v1.RollbackRes, err error)
}
