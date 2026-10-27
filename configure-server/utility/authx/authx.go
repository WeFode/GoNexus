package authx

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/container/gvar"
	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"configure-server/internal/consts"
)

type Principal struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type account struct {
	Username string
	Hash     []byte
	Role     string
}

const (
	maxLoginFails   = 5
	lockDuration    = 10 * time.Minute
	tableName       = "auth_users"
	roleAdminValue  = consts.RoleAdmin
	roleOperatorVal = consts.RoleOperator
)

type attempt struct {
	fails int
	until time.Time
}

var (
	once     sync.Once
	initErr  error
	secret   []byte
	expire   time.Duration
	accounts []account // 仅在审计库不可用时作为回退
	useDB    bool
	loginMu  sync.Mutex
	fails    = map[string]*attempt{}
)

type userCfg struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func Init(ctx context.Context) error {
	once.Do(func() {
		initErr = load(ctx)
	})
	return initErr
}

func load(ctx context.Context) error {
	s := strings.TrimSpace(g.Cfg().MustGet(ctx, "auth.jwtSecret").String())
	if s == "" {
		return gerror.New("本地配置缺少 auth.jwtSecret")
	}
	secret = []byte(s)

	expire = g.Cfg().MustGet(ctx, "auth.expire", "24h").Duration()
	if expire <= 0 {
		expire = 24 * time.Hour
	}

	cfgUsers, err := loadCfgUsers(ctx)
	if err != nil {
		return err
	}

	// 审计库账户表优先：可用则 Web 登录全部走表（bcrypt + 失败锁定 + last_login）。
	if err = seedUserTable(ctx, cfgUsers); err == nil {
		useDB = true
		g.Log().Infof(ctx, "登录账户已启用审计库表 %s（bcrypt 哈希，失败 %d 次锁定 %s）", tableName, maxLoginFails, lockDuration)
	} else {
		// 表未建/库不可用 → 回退 config.yaml 静态账户，保持系统可用
		g.Log().Warningf(ctx, "审计库账户表不可用（%v），回退 config.yaml 静态账户；建议执行 manifest/sql/.../004_auth_users.sql", err)
		accounts = cfgUsers
	}
	return nil
}

func loadCfgUsers(ctx context.Context) ([]account, error) {
	var users []userCfg
	if err := g.Cfg().MustGet(ctx, "auth.users").Scan(&users); err != nil {
		return nil, gerror.Wrap(err, "读取 auth.users 失败")
	}
	if len(users) == 0 {
		return nil, gerror.New("本地配置缺少 auth.users，至少需要一个账户")
	}
	seen := map[string]struct{}{}
	out := make([]account, 0, len(users))
	for _, u := range users {
		name := strings.TrimSpace(u.Username)
		pass := u.Password
		role := strings.TrimSpace(u.Role)
		if name == "" || pass == "" {
			return nil, gerror.New("auth.users 的 username / password 不能为空")
		}
		if role != roleAdminValue && role != roleOperatorVal {
			return nil, gerror.Newf("账户 %s 的 role 只能是 admin 或 operator", name)
		}
		if _, ok := seen[name]; ok {
			return nil, gerror.Newf("重复账户: %s", name)
		}
		seen[name] = struct{}{}
		hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		out = append(out, account{Username: name, Hash: hash, Role: role})
	}
	return out, nil
}

// seedUserTable 校验账户表可用；表为空时用 config.yaml 的账户初始化。
func seedUserTable(ctx context.Context, cfgUsers []account) error {
	if _, err := g.DB().Model(tableName).Count(); err != nil {
		return err
	}
	n, err := g.DB().Model(tableName).Count()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	for _, u := range cfgUsers {
		if _, err = g.DB().Model(tableName).Data(g.Map{
			"username":      u.Username,
			"password_hash": string(u.Hash),
			"role":          u.Role,
			"enabled":       1,
		}).Insert(); err != nil {
			return err
		}
	}
	g.Log().Infof(ctx, "账户表为空，已从 config.yaml 初始化 %d 个账户（建议尽快在库里改密）", len(cfgUsers))
	return nil
}

type dbUser struct {
	Id       int64
	Username string
	Password string
	Role     string
	Enabled  int
}

// fieldOf 大小写不敏感地从结果行取列（DM 返回大写列名，pgsql 为小写）。
func fieldOf(rec gdb.Record, want string) (v *gvar.Var, ok bool) {
	if v, ok = rec[want]; ok {
		return
	}
	for k, val := range rec {
		if strings.EqualFold(k, want) {
			return val, true
		}
	}
	return nil, false
}

// field 取列值；列缺失时返回零值 Var。
func field(rec gdb.Record, want string) *gvar.Var {
	v, ok := fieldOf(rec, want)
	if !ok || v == nil {
		return gvar.New(nil)
	}
	return v
}

func loginByDB(ctx context.Context, username, password string) (string, time.Time, Principal, error) {
	if err := checkLockout(username); err != nil {
		return "", time.Time{}, Principal{}, err
	}
	rec, err := g.DB().Model(tableName).Where("username", username).One()
	if err != nil {
		return "", time.Time{}, Principal{}, gerror.New("登录服务暂时不可用，请稍后再试")
	}
	bad := gerror.New("用户名或密码错误")
	if rec.IsEmpty() {
		recordFail(username)
		return "", time.Time{}, Principal{}, bad
	}
	u := dbUser{
		Id:       field(rec, "id").Int64(),
		Username: field(rec, "username").String(),
		Password: field(rec, "password_hash").String(),
		Role:     field(rec, "role").String(),
		Enabled:  field(rec, "enabled").Int(),
	}
	if u.Id == 0 || u.Enabled != 1 || bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password)) != nil {
		g.Log().Debugf(ctx, "login miss: id=%d enabled=%d role=%q user=%q hashLen=%d", u.Id, u.Enabled, u.Role, u.Username, len(u.Password))
		recordFail(username)
		return "", time.Time{}, Principal{}, bad
	}
	clearFail(username)
	_, _ = g.DB().Model(tableName).Where("id", u.Id).
		Data(g.Map{"last_login": gtime.Now()}).Update()
	token, exp, err := issueToken(u.Username, u.Role)
	if err != nil {
		return "", time.Time{}, Principal{}, err
	}
	return token, exp, Principal{Username: u.Username, Role: u.Role}, nil
}

func lockoutKey(username string) string { return strings.ToLower(username) }

func checkLockout(username string) error {
	loginMu.Lock()
	defer loginMu.Unlock()
	a := fails[lockoutKey(username)]
	if a == nil {
		return nil
	}
	if a.fails >= maxLoginFails && time.Now().Before(a.until) {
		left := time.Until(a.until).Round(time.Second)
		return gerror.Newf("失败次数过多，账户已临时锁定，请 %s 后再试", left)
	}
	return nil
}

func recordFail(username string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	k := lockoutKey(username)
	a := fails[k]
	if a == nil {
		a = &attempt{}
		fails[k] = a
	}
	a.fails++
	if a.fails >= maxLoginFails {
		a.until = time.Now().Add(lockDuration)
	}
}

func clearFail(username string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(fails, lockoutKey(username))
}

func issueToken(username, role string) (token string, expireAt time.Time, err error) {
	now := time.Now()
	exp := now.Add(expire)
	claims := Claims{
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   username,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	return signed, exp, err
}

func loginByCfg(username, password string) (string, time.Time, Principal, error) {
	if err := checkLockout(username); err != nil {
		return "", time.Time{}, Principal{}, err
	}
	var acc *account
	for i := range accounts {
		if accounts[i].Username == username {
			acc = &accounts[i]
			break
		}
	}
	if acc == nil || bcrypt.CompareHashAndPassword(acc.Hash, []byte(password)) != nil {
		recordFail(username)
		return "", time.Time{}, Principal{}, gerror.New("用户名或密码错误")
	}
	clearFail(username)
	token, exp, err := issueToken(acc.Username, acc.Role)
	if err != nil {
		return "", time.Time{}, Principal{}, err
	}
	return token, exp, Principal{Username: acc.Username, Role: acc.Role}, nil
}

func Login(ctx context.Context, username, password string) (token string, expireAt time.Time, p Principal, err error) {
	username = strings.TrimSpace(username)
	if useDB {
		return loginByDB(ctx, username, password)
	}
	return loginByCfg(username, password)
}

func Parse(token string) (*Claims, error) {
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" {
		return nil, gerror.New("未登录")
	}
	parsed, err := jwt.ParseWithClaims(token, &Claims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, gerror.New("非法 token")
		}
		return secret, nil
	})
	if err != nil || parsed == nil || !parsed.Valid {
		return nil, gerror.New("未登录或登录已过期")
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return nil, gerror.New("未登录或登录已过期")
	}
	return claims, nil
}
