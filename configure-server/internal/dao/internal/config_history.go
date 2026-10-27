// ==========================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// ==========================================================================

package internal

import (
	"context"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"
)

// ConfigHistoryDao is the data access object for the table CONFIG_HISTORY.
type ConfigHistoryDao struct {
	table    string               // table is the underlying table name of the DAO.
	group    string               // group is the database configuration group name of the current DAO.
	columns  ConfigHistoryColumns // columns contains all the column names of Table for convenient usage.
	handlers []gdb.ModelHandler   // handlers for customized model modification.
}

// ConfigHistoryColumns defines and stores column names for the table CONFIG_HISTORY.
type ConfigHistoryColumns struct {
	Id         string //
	ConfigKey  string //
	Version    string //
	Content    string //
	ActionType string //
	Operator   string //
	Remark     string //
	CreatedAt  string //
}

// configHistoryColumns holds the columns for the table CONFIG_HISTORY.
var configHistoryColumns = ConfigHistoryColumns{
	Id:         "ID",
	ConfigKey:  "CONFIG_KEY",
	Version:    "VERSION",
	Content:    "CONTENT",
	ActionType: "ACTION_TYPE",
	Operator:   "OPERATOR",
	Remark:     "REMARK",
	CreatedAt:  "CREATED_AT",
}

// NewConfigHistoryDao creates and returns a new DAO object for table data access.
func NewConfigHistoryDao(handlers ...gdb.ModelHandler) *ConfigHistoryDao {
	return &ConfigHistoryDao{
		group:    "default",
		table:    "CONFIG_HISTORY",
		columns:  configHistoryColumns,
		handlers: handlers,
	}
}

// DB retrieves and returns the underlying raw database management object of the current DAO.
func (dao *ConfigHistoryDao) DB() gdb.DB {
	return g.DB(dao.group)
}

// Table returns the table name of the current DAO.
func (dao *ConfigHistoryDao) Table() string {
	return dao.table
}

// Columns returns all column names of the current DAO.
func (dao *ConfigHistoryDao) Columns() ConfigHistoryColumns {
	return dao.columns
}

// Group returns the database configuration group name of the current DAO.
func (dao *ConfigHistoryDao) Group() string {
	return dao.group
}

// Ctx creates and returns a Model for the current DAO. It automatically sets the context for the current operation.
func (dao *ConfigHistoryDao) Ctx(ctx context.Context) *gdb.Model {
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
func (dao *ConfigHistoryDao) Transaction(ctx context.Context, f func(ctx context.Context, tx gdb.TX) error) (err error) {
	return dao.Ctx(ctx).Transaction(ctx, f)
}
