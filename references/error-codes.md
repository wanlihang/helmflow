# ErrorCodeEnum 速查清单

> 来源:`com.mycm.common.model.exception.ErrorCodeEnum`(mycm-common-1.0.0.20250828.jar)
> 本清单覆盖 java-ddd preset 下**最常用**的错误码及适用场景。
> 完整枚举请直接看 jar:`unzip -p ~/.m2/repository/com/mycm/common/mycm-component/1.0.0.20250828/mycm-component-1.0.0.20250828.jar com/mycm/common/model/exception/ErrorCodeEnum.class`(或在 IDE 里 Cmd+B 进 jar)。
>
> AI 在写 `throw new MycmBizException(ErrorCodeEnum.X, "...")` 时,必须从本清单选一个;清单里没有的不要凭空发明,先查 jar。

---

## 1. 选码决策树

```
是不是请求参数本身有问题?  → ILLEGAL_ARGUMENT
是不是数据没找到?           → DATA_IS_EMPTY
是不是数据校验/格式错?      → DATA_VALIDATE_ERROR
是不是业务规则冲突?         → BIZ_ERROR(默认)
是不是配置错?               → CONFIGURATION_ERROR
是不是外部系统/IO/RPC 失败? → SYSTEM_INNER_ERROR(配 MycmSysException)
是不是 stub 占位?           → SYSTEM_INNER_ERROR + "...待对接"(配 MycmSysException)
其他业务错                   → BIZ_ERROR
```

---

## 2. 常用错误码及适用场景

### 参数错误类

| 枚举 | 配套异常 | 适用场景 | 示例消息 |
|------|---------|---------|---------|
| `ILLEGAL_ARGUMENT` | `MycmBizException` | 参数缺失/格式不对/枚举值非法/单字段约束失败 | `"主键 ID 不能为空"` / `"邮箱地址格式不正确"` |
| `DATA_VALIDATE_ERROR` | `MycmBizException` | 跨字段校验失败 / 数据完整性校验失败 / Schema 校验失败 | `"邮箱黑名单数据校验失败"` / `"开始时间不能晚于结束时间"` |

### 数据查询类

| 枚举 | 配套异常 | 适用场景 | 示例消息 |
|------|---------|---------|---------|
| `DATA_IS_EMPTY` | `MycmBizException` | 期望存在的实体未查到 / 必填关联数据为空 | `"交付需求不存在: " + bizNo` / `"产品树未配置"` |

### 业务规则类

| 枚举 | 配套异常 | 适用场景 | 示例消息 |
|------|---------|---------|---------|
| `BIZ_ERROR` | `MycmBizException` | 业务规则冲突 / 状态前置不满足 / 权限不足 / 业务流程错误 | `"当前状态不允许提交映射: status=" + status` / `"无权操作该交付需求"` / `"已存在 active 任务"` |

### 配置类

| 枚举 | 配套异常 | 适用场景 | 示例消息 |
|------|---------|---------|---------|
| `CONFIGURATION_ERROR` | `MycmBizException` 或 `MycmSysException` | Spring 配置错 / Mapper 配置错 / 启动期配置缺失 | `"mapperLocations is null"` |

### 系统/基础设施类

| 枚举 | 配套异常 | 适用场景 | 示例消息 |
|------|---------|---------|---------|
| `SYSTEM_INNER_ERROR` | `MycmSysException` | DB/RPC/IO/外部系统调用失败 / 未捕获的 RuntimeException 兜底 / **stub 占位** | `"查询邮箱黑名单失败"`(catch 后包装) / `"PriceValidationService#validateConfig 待对接"`(stub) |

---

## 3. MycmBizException vs MycmSysException 何时用哪个

| 异常类 | 语义 | 触发场景 | 调用方期望处理 |
|--------|------|---------|------------|
| `MycmBizException` | **业务异常**(可预期、可向用户解释) | 参数错、数据没找到、业务规则冲突、状态前置不满足 | Result.fail(code, msg) 透传到前端,用户看得懂 |
| `MycmSysException` | **系统异常**(基础设施/不可预期) | DB 挂了、RPC 超时、Mapper 抛 SQLException、stub 占位、不可恢复错误 | 走告警通道,前端通常显示"系统繁忙",运维介入排查 |

### 包装规则

```java
// ✅ 正确:catch 基础设施异常,包装为 MycmSysException
try {
    return mapper.selectByEmail(email);
} catch (Exception e) {
    throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR, "查询邮箱黑名单失败", e);
    //                                                    ↑↑↑ 第三个参数传原异常,保留 cause
}

// ✅ 正确:业务规则冲突,直接抛 MycmBizException
if (!"PD_CONFIG".equals(record.getStatus())) {
    throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
        "当前状态不允许提交映射: status=" + record.getStatus());
}

// ❌ 错误:把业务规则冲突包成 SYS_ERROR,前端拿到"系统繁忙"看不懂
throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR, "状态不对");

// ❌ 错误:DB 异常包成 BizException,告警链路丢失
catch (SQLException e) {
    throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR, "查询失败");
}
```

---

## 4. 严禁使用的占位/异常写法

| 反例 | 为什么不行 | 正确替代 |
|------|----------|---------|
| `throw new IllegalStateException("not implemented")` | 跳过 ErrorCodeEnum 体系,Result 包装失效,日志/告警链路丢失 | `throw new MycmSysException(SYSTEM_INNER_ERROR, "{Class}#{method} 待对接")` |
| `throw new IllegalArgumentException("xxx")` | 同上;且语义混淆(框架的 IllegalArgumentException 通常表示"调用约定违反") | `throw new MycmBizException(ILLEGAL_ARGUMENT, "xxx")` |
| `throw new UnsupportedOperationException()` | 同上 | `throw new MycmSysException(SYSTEM_INNER_ERROR, "{Class}#{method} 待对接")` |
| `throw new RuntimeException("xxx")` | 没有错误码,Result.fail 拿不到 code | 任选合适的 ErrorCodeEnum + Mycm{Biz/Sys}Exception |
| `Result.fail("PARAM_INVALID", ...)` 硬编码字符串 | `Result.fail(String, ...)` 这个静态方法**不存在**,编译过不了 | `Result.fail(ErrorCodeEnum.ILLEGAL_ARGUMENT, ...)` 或交给 BizTemplate 自动包装 |

---

## 5. 项目自定义错误码的扩展方式

如果业务确实需要枚举里没有的错误码,**不要直接在业务代码里抛字符串**,正确做法:

1. 申请扩展 `mycm-common.ErrorCodeEnum`(走 mycm-common 升级流程),或
2. 在项目 `domain/{context}/exception/` 下定义自己的 `XxxBizException extends MycmBizException`,
   构造时仍用现有 `ErrorCodeEnum.BIZ_ERROR`,但通过子类型在 BizTemplate 兜底处区分

**不允许**的做法:在业务代码里 `throw new MycmBizException(null, "msg")` 或 `throw new MycmBizException(SOMECODE, "msg")` 而 SOMECODE 不是 enum value。

---

## 6. AI 写代码时的检查顺序

1. 选错误码前,**先查本清单**:决策树→选场景→拿到对应 enum
2. 如果场景在清单里没有,**绝不凭空编造 enum 名**(如 `TASK_DUPLICATE` / `STATUS_NOT_ALLOWED` 这类项目特有的语义错误码,如果 jar 里没有就不要写,改用 `BIZ_ERROR + 描述性 message`)
3. 区分 Biz 还是 Sys:用户能看懂 → Biz;基础设施/stub → Sys
4. message 要带具体业务上下文(`bizNo`、`status`、字段名),不要写 `"error"` / `"failed"` 这种空话

---

## 关联

- **memory**:[[feedback-error-code-check-jar-first]] — AI 写错误码前必读本清单,清单外的不发明
- **patterns**:`patterns/stub-and-bean-naming.md` 规则 3 — stub 占位统一用 `SYSTEM_INNER_ERROR`
- **review-rules**:§D 异常处理 + §I-3 严禁抛 JDK 异常
