package product

import (
	"context"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"

	v1 "shop-server/api/product/v1"
	"shop-server/internal/dao"
	"shop-server/internal/model/do"
	"shop-server/internal/model/entity"
	"shop-server/internal/service"
	"shop-server/utility"
)

type sProduct struct{}

func init() {
	service.RegisterProduct(New())
}

func New() *sProduct {
	return &sProduct{}
}

func toItem(row *entity.Products) v1.ProductItem {
	item := v1.ProductItem{
		Id:          row.Id,
		Name:        row.Name,
		Description: row.Description,
		Price:       row.Price,
		Stock:       row.Stock,
		Status:      row.Status,
	}
	if row.CreatedAt != nil {
		item.CreatedAt = row.CreatedAt.String()
	}
	if row.UpdatedAt != nil {
		item.UpdatedAt = row.UpdatedAt.String()
	}
	return item
}

func (s *sProduct) Create(ctx context.Context, req *v1.CreateReq) (*v1.CreateRes, error) {
	id, err := dao.Products.Ctx(ctx).Data(do.Products{
		Name:        req.Name,
		Description: req.Description,
		Price:       req.Price,
		Stock:       req.Stock,
		Status:      req.Status,
		CreatedAt:   gtime.Now(),
		UpdatedAt:   gtime.Now(),
	}).InsertAndGetId()
	if err != nil {
		return nil, err
	}
	g.Log().Infof(ctx, "创建商品成功 id=%d name=%s", id, req.Name)
	return &v1.CreateRes{Id: id}, nil
}

func (s *sProduct) Get(ctx context.Context, id int64) (*v1.GetRes, error) {
	var row entity.Products
	err := dao.Products.Ctx(ctx).WherePri(id).Scan(&row)
	if err != nil {
		if utility.IsNoRowsError(err) {
			return nil, gerror.Newf("product %d not found", id)
		}
		return nil, err
	}
	if row.Id == 0 {
		return nil, gerror.Newf("product %d not found", id)
	}
	return &v1.GetRes{ProductItem: toItem(&row)}, nil
}

func (s *sProduct) List(ctx context.Context, req *v1.ListReq) (*v1.ListRes, error) {
	m := dao.Products.Ctx(ctx)
	if req.Name != "" {
		m = m.WhereLike(dao.Products.Columns().Name, "%"+req.Name+"%")
	}
	if req.Status != nil {
		m = m.Where(dao.Products.Columns().Status, *req.Status)
	}

	total, err := m.Count()
	if err != nil {
		return nil, err
	}

	var rows []*entity.Products
	err = m.OrderDesc(dao.Products.Columns().Id).
		Page(req.Page, req.Size).
		Scan(&rows)
	if err != nil {
		return nil, err
	}

	list := make([]v1.ProductItem, 0, len(rows))
	for _, row := range rows {
		list = append(list, toItem(row))
	}
	return &v1.ListRes{
		Total: total,
		Page:  req.Page,
		Size:  req.Size,
		List:  list,
	}, nil
}

func (s *sProduct) Update(ctx context.Context, req *v1.UpdateReq) error {
	cnt, err := dao.Products.Ctx(ctx).WherePri(req.Id).Count()
	if err != nil {
		return err
	}
	if cnt == 0 {
		return gerror.Newf("product %d not found", req.Id)
	}

	data := g.Map{}
	if req.Name != nil {
		data[dao.Products.Columns().Name] = *req.Name
	}
	if req.Description != nil {
		data[dao.Products.Columns().Description] = *req.Description
	}
	if req.Price != nil {
		data[dao.Products.Columns().Price] = *req.Price
	}
	if req.Stock != nil {
		data[dao.Products.Columns().Stock] = *req.Stock
	}
	if req.Status != nil {
		data[dao.Products.Columns().Status] = *req.Status
	}
	if len(data) == 0 {
		return nil
	}
	data[dao.Products.Columns().UpdatedAt] = gtime.Now()

	_, err = dao.Products.Ctx(ctx).WherePri(req.Id).Data(data).Update()
	if err == nil {
		g.Log().Infof(ctx, "更新商品成功 id=%d fields=%d", req.Id, len(data))
	}
	return err
}

func (s *sProduct) Delete(ctx context.Context, id int64) error {
	result, err := dao.Products.Ctx(ctx).WherePri(id).Delete()
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return gerror.Newf("product %d not found", id)
	}
	g.Log().Infof(ctx, "删除商品成功 id=%d", id)
	return nil
}
