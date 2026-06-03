# Acceptor Pattern

> When to use: 在 FacadeImpl 调 Handler 之前,把"业务受理"逻辑——**参数校验 + 状态前置检查 + 权限判断**——
> 集中到 Acceptor。Handler 拿到的 Context 就是"已经过受理"的可信输入,Handler 内只关心编排,不再做防御性校验。
>
> **与 BizTemplate / Handler 的分工**:
> - `BizTemplate.doProcess()` —— Facade 入口兜底:声明式参数校验(`@NotBlank` / `@Valid`)+ 异常捕获 + Result 包装
> - `Acceptor` —— 业务受理:跨字段校验、状态前置、权限、幂等键预检
> - `Handler` —— 业务编排:run(action, ctx) 顺序执行原子动作
>
> **跨项目/类型约束**: Acceptor 是可选增强。简单 CRUD(EmailBlacklist 这种)用 BizTemplate + Service 直连即可,
> 不强求每个 Facade 方法都套一层 Acceptor。判断标准:
> "这次写操作需要查 DB 才能判断能不能做" → 用 Acceptor;否则放在 Command 上的 `@Valid` 注解里。

## 核心定位

```
┌────────────────────────────────────────────────────────────────┐
│  FacadeImpl.submitMapping(command)                             │
│  └─ BizTemplate.doProcess(command, () -> {                     │
│       │   ┌──────────────────────────────────────────────┐     │
│       ├──>│ Acceptor.acceptSubmit(command)               │     │
│       │   │  - 参数级联校验(跨字段)                       │     │
│       │   │  - 查 DB 验状态前置(当前=PD_CONFIG?)           │     │
│       │   │  - 权限判断(operator 是否有权操作?)            │     │
│       │   │  - 幂等键预检(同一 bizNo 是否已处理?)           │     │
│       │   └──────────────────────────────────────────────┘     │
│       │   ┌──────────────────────────────────────────────┐     │
│       └──>│ Handler.execute(ctx)                         │     │
│           │  - 编排 Action 顺序                           │     │
│           └──────────────────────────────────────────────┘     │
│     });                                                        │
└────────────────────────────────────────────────────────────────┘
```

## Acceptor 实现

```java
package {PACKAGE}.application.{MODULE}.acceptor;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import org.springframework.util.Assert;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import {PACKAGE}.domain.{MODULE}.model.DeliverRecord;
import {PACKAGE}.domain.{MODULE}.repository.DeliverRecordRepository;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}SubmitCommand;

/**
 * {Business} 业务受理。负责:
 * 1. 参数跨字段校验(单字段约束用 @Valid 在 Command 上声明,这里不重复)
 * 2. 状态前置检查(查 DB 判断当前状态是否允许该操作)
 * 3. 权限判断
 * 4. 幂等键预检
 *
 * <p>Acceptor 不写 DB,只读 DB + 抛业务异常。
 * <p>Acceptor 一个功能点一个,与 Handler 在同一 {context} 包下成对出现。
 */
@Component
public class {Business}Acceptor {

    @Resource
    private DeliverRecordRepository deliverRecordRepository;

    /**
     * 受理"提交映射"操作。校验通过则返回;不通过则抛 MycmBizException。
     */
    public void acceptSubmit({Business}SubmitCommand command) {
        // 1. 跨字段校验(单字段已被 @Valid 覆盖)
        Assert.isTrue(
            command.getNodeNoList() != null && !command.getNodeNoList().isEmpty(),
            "nodeNoList 不能为空");

        // 2. 状态前置:查 DB 验当前状态是否允许提交
        DeliverRecord record = deliverRecordRepository.getByBizNo(command.getBizNo());
        if (record == null) {
            throw new MycmBizException(ErrorCodeEnum.DATA_IS_EMPTY,
                "交付需求不存在: " + command.getBizNo());
        }
        if (!"PD_CONFIG".equals(record.getStatus())) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "当前状态不允许提交映射: status=" + record.getStatus());
        }

        // 3. 权限判断:operator 是否有权操作该 bizNo
        if (!record.getCreator().equals(command.getOperator())
                && !isAdmin(command.getOperator())) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "无权操作该交付需求: " + command.getOperator());
        }

        // 4. 幂等键预检(若已处理过则直接放行/拒绝,由业务语义决定)
        // ...
    }

    private boolean isAdmin(String operator) {
        // TODO: 接权限系统判断
        return false;
    }
}
```

## FacadeImpl 调用范式

```java
@RpcProvider
public class {Business}ManageFacadeImpl implements {Business}ManageFacade {

    @Autowired private BizTemplate bizTemplate;
    @Autowired private {Business}Acceptor {business}Acceptor;
    @Autowired private {Business}SubmitHandler {business}SubmitHandler;

    @Override
    @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
    public Result<Void> submit{Business}(@Valid {Business}SubmitCommand command) {
        return bizTemplate.doProcess(command, () -> {
            {business}Acceptor.acceptSubmit(command);            // 1. 受理校验
            {Business}Context ctx = {Business}Context.builder()  // 2. 构建可信上下文
                .bizNo(command.getBizNo())
                .operator(command.getOperator())
                .build();
            {business}SubmitHandler.execute(ctx);                 // 3. 编排执行
            return null;
        });
    }
}
```

## 反模式

```java
// ❌ 反模式 1: Acceptor 写 DB(包括 update 状态)
@Component
public class ProdMappingAcceptor {
    public void acceptSubmit(ProdMappingSubmitCommand cmd) {
        DeliverRecord r = repo.getByBizNo(cmd.getBizNo());
        r.setStatus("SUBMITTING");        // ❌ Acceptor 不写 DB
        repo.save(r);                      // ❌ 状态变更归 Handler/Action
    }
}

// ❌ 反模式 2: Acceptor 做编排(调多个 Action / 调外部系统)
@Component
public class ProdMappingAcceptor {
    @Resource private SavePdMappingAction saveAction;     // ❌ Acceptor 不持有 Action
    public void acceptSubmit(ProdMappingSubmitCommand cmd) {
        // ... 校验 ...
        saveAction.process(ctx);          // ❌ 编排是 Handler 的事
    }
}

// ❌ 反模式 3: 把单字段校验也塞进 Acceptor
@Component
public class ProdMappingAcceptor {
    public void acceptSubmit(ProdMappingSubmitCommand cmd) {
        Assert.hasText(cmd.getBizNo(), "bizNo 不能为空");   // ❌ 放 @NotBlank 即可
        Assert.notNull(cmd.getOperator(), "operator 不能为空"); // ❌ 同上
    }
}

// ❌ 反模式 4: Handler 内重复做 Acceptor 已经做过的校验
@Component
public class ProductMappingSubmitHandler extends HandlerTemplate<ProdMappingContext> {
    @Override
    protected void doHandle(ProdMappingContext ctx) {
        DeliverRecord r = repo.getByBizNo(ctx.getBizNo());
        if (!"PD_CONFIG".equals(r.getStatus())) {              // ❌ Acceptor 已经查过了
            throw new MycmBizException(...);
        }
        run(saveAction, ctx);
    }
}
```

## 包路径约束

Acceptor 必须与同一功能点的 Handler/Action/Context 在同一 `{context}` 包下:

```
✅ application/mapping/acceptor/ProdMappingAcceptor.java
✅ application/mapping/handler/ProductMappingSubmitHandler.java
✅ application/mapping/action/SavePdMappingAction.java
✅ application/mapping/context/ProdMappingContext.java

❌ application/acceptor/ProdMappingAcceptor.java           # 水平分包,review 打回
❌ application/common/acceptor/ProdMappingAcceptor.java    # 同上
```

参见 [`standards.md` §0 核心原则](../standards.md#0-核心原则按业务功能点-context-内聚)。
