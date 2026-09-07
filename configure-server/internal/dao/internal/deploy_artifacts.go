// ==========================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// ==========================================================================

package internal

import (
	"context"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"
)

// DeployArtifactsDao is the data access object for the table DEPLOY_ARTIFACTS.
type DeployArtifactsDao struct {
	table    string                 // table is the underlying table name of the DAO.
	group    string                 // group is the database configuration group name of the current DAO.
	columns  DeployArtifactsColumns // columns contains all the column names of Table for convenient usage.
	handlers []gdb.ModelHandler     // handlers for customized model modification.
}

// DeployArtifactsColumns defines and stores column names for the table DEPLOY_ARTIFACTS.
type DeployArtifactsColumns struct {
	Id            string //
	ServiceName   string //
	ImageName     string //
	Platform      string //
	ContainerPort string //
	FilePath      string //
	FileSize      string //
	Sha256        string //
	Operator      string //
	CreatedAt     string //
}

// deployArtifactsColumns holds the columns for the table DEPLOY_ARTIFACTS.
var deployArtifactsColumns = DeployArtifactsColumns{
	Id:            "ID",
	ServiceName:   "SERVICE_NAME",
	ImageName:     "IMAGE_NAME",
	Platform:      "PLATFORM",
	ContainerPort: "CONTAINER_PORT",
	FilePath:      "FILE_PATH",
	FileSize:      "FILE_SIZE",
	Sha256:        "SHA256",
	Operator:      "OPERATOR",
	CreatedAt:     "CREATED_AT",
}

// NewDeployArtifactsDao creates and returns a new DAO object for table data access.
func NewDeployArtifactsDao(handlers ...gdb.ModelHandler) *DeployArtifactsDao {
	return &DeployArtifactsDao{
		group:    "default",
		table:    "DEPLOY_ARTIFACTS",
		columns:  deployArtifactsColumns,
		handlers: handlers,
	}
}

// DB retrieves and returns the underlying raw database management object of the current DAO.
func (dao *DeployArtifactsDao) DB() gdb.DB {
	return g.DB(dao.group)
}

// Table returns the table name of the current DAO.
func (dao *DeployArtifactsDao) Table() string {
	return dao.table
}

// Columns returns all column names of the current DAO.
func (dao *DeployArtifactsDao) Columns() DeployArtifactsColumns {
	return dao.columns
}

// Group returns the database configuration group name of the current DAO.
func (dao *DeployArtifactsDao) Group() string {
	return dao.group
}

// Ctx creates and returns a Model for the current DAO. It automatically sets the context for the current operation.
func (dao *DeployArtifactsDao) Ctx(ctx context.Context) *gdb.Model {
	model := dao.DB().Model(dao.table)
	for _, handler := range dao.handlers {
		model = handler(model)
	}
	return model.Safe().Ctx(ctx)
}

// Transaction wraps the transaction logic using function f.
// It rolls back the transaction and returns the error if function f returns a non-nil error.
// It commits the transaction and returns nil if function f returns nil.
//
// Note: Do not commit or roll back the transaction in function f,
// as it is automatically handled by this function.
func (dao *DeployArtifactsDao) Transaction(ctx context.Context, f func(ctx context.Context, tx gdb.TX) error) (err error) {
	return dao.Ctx(ctx).Transaction(ctx, f)
}
