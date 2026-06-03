# Facade Pattern

> When to use: Define a Facade at the module boundary to expose business capabilities to external consumers (RPC clients, other modules). Every external call enters through a Facade that wraps results in `Result<T>` and applies interceptors.
>
> **跨项目数据**: 6/7 项目使用 BizTemplate 模式，1/7 使用手动 try-catch。
> 以下展示 BizTemplate 作为默认模式。项目约定可覆盖为手动模式。

## Facade Interface

```java
package {PACKAGE}.facade.{MODULE};

import {PACKAGE}.facade.{MODULE}.model.command.{Business}CreateCommand;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}UpdateCommand;
import {PACKAGE}.facade.{MODULE}.model.query.{Business}Query;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.Result;
import com.mycm.common.model.Paginator;

public interface {Business}ManageFacade {

    Result<{Business}VO> create{Business}({Business}CreateCommand command);

    Result<{Business}VO> update{Business}({Business}UpdateCommand command);

    Result<Void> cancel{Business}(Long id);
}
```

```java
package {PACKAGE}.facade.{MODULE};

import {PACKAGE}.facade.{MODULE}.model.query.{Business}Query;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.Result;
import com.mycm.common.model.Paginator;

public interface {Business}QueryFacade {

    Result<{Business}VO> query{Business}(Long id);

    Result<Paginator<{Business}VO>> list{Business}({Business}Query query);
}
```

## FacadeImpl — BizTemplate 模式（默认）

> **类型约束**: `BizTemplate.doProcess(R request, BizCallback<T> action)` 的 `R extends BaseRequest`。
> 因此所有 facade 入参对象必须 `extends BaseRequest`(不要只 `implements Serializable`),
> 否则编译期就报 `inferred type does not conform to upper bound`。
>
> **不接受 Long id 直接调 doProcess**: 把它包成 `XxxRemoveCommand extends BaseRequest`。
> 这是模式硬约束,不是审美偏好。

```java
package {PACKAGE}.application.{MODULE}.facade;

import com.alipay.sofa.rpc.api.annotation.RpcProvider;
import org.springframework.beans.factory.annotation.Autowired;
import {PACKAGE}.facade.{MODULE}.{Business}ManageFacade;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}CreateCommand;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}UpdateCommand;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}CancelCommand;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import {PACKAGE}.application.{MODULE}.service.{Business}ManageService;
import com.mycm.common.model.base.Result;
import com.mycm.common.component.log.annotation.FacadeIntercept;
import {PACKAGE}.infrastructure.log.MycmLoggerDef;
import com.mycm.common.component.template.BizTemplate;
import com.mycm.common.component.template.BizCallback;

import javax.validation.Valid;

/**
 * {Business} manage facade implementation.
 *
 * BizTemplate.doProcess 兜底:参数校验(AnnotationValidator) + 异常捕获 +
 * Result.fail(errorCode, msg) 包装。Facade 方法里只剩"取数据 / 编排领域服务"。
 *
 * @FacadeIntercept 兜底:打印入参 / 出参 / 耗时,所以 facade 内部不再 log.warn/log.error。
 */
@RpcProvider
public class {Business}ManageFacadeImpl implements {Business}ManageFacade {

    @Autowired
    private {Business}ManageService {business}ManageService;

    @Autowired
    private BizTemplate bizTemplate;

    /** 复杂场景:匿名 BizCallback,显式声明 validate / idempotent / execute。 */
    @Override
    @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
    public Result<{Business}VO> create{Business}(@Valid {Business}CreateCommand command) {
        return bizTemplate.doProcess(command, new BizCallback<{Business}VO>() {
            @Override
            public void validate() {
                // 跨字段或动态前置校验放这里;单字段约束用 @NotBlank/@Email 在 Command 类上声明
            }

            @Override
            public {Business}VO execute() {
                return {business}ManageService.create{Business}(command);
            }
        });
    }

    /** 简单场景:lambda,只编排 service 调用。 */
    @Override
    @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
    public Result<{Business}VO> update{Business}(@Valid {Business}UpdateCommand command) {
        return bizTemplate.doProcess(command,
                () -> {business}ManageService.update{Business}(command));
    }

    /** 无返回值场景:lambda 内 return null,doProcess 自动包成 Result<Void>。 */
    @Override
    @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
    public Result<Void> cancel{Business}(@Valid {Business}CancelCommand command) {
        return bizTemplate.doProcess(command, () -> {
            {business}ManageService.cancel{Business}(command.getId(), command.getOperator());
            return null;
        });
    }
}
```

### 三个常见反模式(在 review 时直接打回)

```java
// ❌ 反模式 1: 入参不是 BaseRequest,doProcess 不会过编译
public Result<Void> cancel{Business}(Long id) {
    return bizTemplate.doProcess(id, () -> ...);   // ❌ 编译错: Long 不是 BaseRequest
}

// ❌ 反模式 2: 自己 try/catch + Result.fail,BizTemplate 兜底全废
public Result<Void> add(Cmd cmd) {
    try { service.save(cmd); return Result.success(); }
    catch (Exception e) { return Result.fail(ErrorCodeEnum.SYSTEM_INNER_ERROR, "x"); }
    // ↑ 失去了 BizTemplate 对 MycmBizException → buildExceptionResult(e) 的精确转换
}

// ❌ 反模式 3: facade 里 log.warn/log.error 重复打印
public Result<Void> add(Cmd cmd) {
    try { ... } catch (Exception e) {
        log.error("add failed", e);  // ❌ @FacadeIntercept 已经打了一遍
        throw e;
    }
}
```

> **项目约定覆盖**: RPC 发布注解可能是 `@RpcProvider`(mycm 主流) 或 `@SofaService`。
> Logger 常量名:本仓库标准为 `MycmLoggerDef.FACADE_SERVICE_LOGGER`(继承 `com.mycm.common.model.constants.LoggerDef`)。

## Command Class

```java
package {PACKAGE}.facade.{MODULE}.model.command;

import lombok.Data;
import lombok.EqualsAndHashCode;
import com.mycm.common.model.base.BaseRequest;

@Data
@EqualsAndHashCode(callSuper = true)
public class {Business}CreateCommand extends BaseRequest {

    private static final long serialVersionUID = 1L;

    private String {business}No;
    private String type;
    private Long amount;
    private String currency;
    private String remark;
}
```

```java
package {PACKAGE}.facade.{MODULE}.model.command;

import lombok.Data;
import lombok.EqualsAndHashCode;
import com.mycm.common.model.base.BaseRequest;

@Data
@EqualsAndHashCode(callSuper = true)
public class {Business}UpdateCommand extends BaseRequest {

    private static final long serialVersionUID = 1L;

    private Long id;
    private String remark;
}
```

## Query Class

```java
package {PACKAGE}.facade.{MODULE}.model.query;

import lombok.Data;
import lombok.EqualsAndHashCode;
import com.mycm.common.model.base.BaseRequest;

@Data
@EqualsAndHashCode(callSuper = true)
public class {Business}Query extends BaseRequest {

    private static final long serialVersionUID = 1L;

    private String {business}No;
    private String status;
    private String type;
    private Integer pageNum;
    private Integer pageSize;
}
```

## VO Class

```java
package {PACKAGE}.facade.{MODULE}.model.vo;

import lombok.Data;
import java.io.Serializable;

@Data
public class {Business}VO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long id;
    private String {business}No;
    private String type;
    private String status;
    private String statusDescription;
    private Long amount;
    private String currency;
    private String remark;
    private String gmtCreate;
    private String gmtModified;
}
```
