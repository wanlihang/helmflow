# Handler + Action Pattern

> When to use(与 `../standards.md` §0.3 单点对齐):任一命中即用 Handler:
> - 含审批回调 / 状态机分支(PASS / REJECT / CANCEL)→ StatefulHandlerTemplate
> - **≥4 步**业务动作,**或**需要细粒度事务边界控制(单 Action 单事务)→ HandlerTemplate
>
> 否则用 Application Service(≤3 步 + 整体一个事务,如 Demo 的 EmailBlacklist)。
>
> 动作步数从契约的"业务规则/流程"段计数,一次 DB 写入或一次外部调用 = 一步。
>
> **与 BizTemplate 的关系**:BizTemplate 仍是 Facade 层的入口兜底(参数校验 + 异常捕获 + Result 包装)。
> HandlerTemplate 处理的是入口内部的**业务动作编排**——FacadeImpl 调 Acceptor 校验后,
> 把请求委托给 Handler 执行。
>
> **配套 pattern**:
> - 前置业务受理(参数跨字段校验 / 状态前置 / 权限 / 幂等键预检)→ 见 [`acceptor.md`](acceptor.md)
> - 简单 CRUD 编排 → 见 [`application-service.md`](application-service.md)
> - 编排路径决策表 → 见 `../standards.md` §0.3
>
> **包路径硬约束**:Handler / Action / Acceptor / Context 必须落在同一 `{context}` 包下
> (如 `application/mapping/{handler,action,acceptor,context}/`),不允许水平分包。
> 详见 `../standards.md` §0.1 / `../review-rules.md` §A0。

## 核心抽象

### Action 接口

```java
package {PACKAGE}.application.shared.handler;

/**
 * 原子业务动作。粒度:一次 DB 写入 或 一次外部调用。
 * Action 之间通过 HandlerContext 传递数据,不做直接依赖。
 */
@FunctionalInterface
public interface Action<C extends HandlerContext> {

    void process(C ctx);
}
```

### HandlerContext 基类

```java
package {PACKAGE}.application.shared.handler;

import lombok.Builder;
import lombok.Getter;

/**
 * Handler 执行上下文。子类用 @Builder 构建不可变对象。
 * 每个 Handler 定义自己的 Context 子类,只暴露该 Handler 需要的字段。
 */
@Getter
public abstract class HandlerContext {

    /** 交付需求编号(或其他业务主键),贯穿整个 Handler 链路。 */
    private final String bizNo;

    /** 操作人。 */
    private final String operator;

    protected HandlerContext(String bizNo, String operator) {
        this.bizNo = bizNo;
        this.operator = operator;
    }
}
```

### OperateLogAction — 基类自动追加的操作日志

```java
package {PACKAGE}.application.shared.handler;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import com.mycm.common.util.LoggerUtil;

/**
 * 操作日志 Action。HandlerTemplate 基类在 execute() 末尾自动追加,
 * 子类无需手写日志逻辑。
 */
@Slf4j
@Component
public class OperateLogAction implements Action<HandlerContext> {

    @Override
    public void process(HandlerContext ctx) {
        LoggerUtil.info(log, "OPERATE-LOG|bizNo={}|operator={}", ctx.getBizNo(), ctx.getOperator());
        // 实际项目中追加操作日志表写入逻辑
    }
}
```

### HandlerExceptionHandler — 异常处理

```java
package {PACKAGE}.application.shared.handler;

import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import com.mycm.common.util.LoggerUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Handler 异常处理。区分业务异常(回滚)与基础设施异常(记录+告警)。
 */
@Slf4j
@Component
public class HandlerExceptionHandler {

    public void handle(HandlerContext ctx, Exception e) {
        if (e instanceof MycmBizException) {
            LoggerUtil.warn(log, "BIZ-HANDLER|bizNo={}|bizError={}",
                ctx.getBizNo(), e.getMessage());
            throw (MycmBizException) e;
        }
        LoggerUtil.error(log, "SYS-HANDLER|bizNo={}|systemError",
            ctx.getBizNo(), e);
        throw new MycmBizException(ErrorCodeEnum.SYSTEM_INNER_ERROR,
            "Handler execution failed: " + ctx.getBizNo(), e);
    }
}
```

## HandlerTemplate — 线性处理模版基类

> **适用场景**:顺序执行的写操作(无状态机分支)。
> 子类在 `doHandle()` 中以代码顺序调用 `run(action, ctx)`,代码写什么就执行什么。

```java
package {PACKAGE}.application.shared.handler;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 线性处理模版基类。
 *
 * <p>职责链:doHandle() 定义执行顺序 → run() 包事务 + 异常兜底 → execute() 自动追加操作日志。
 * 子类只写业务逻辑,不写横切代码。
 *
 * <p>典型用法:
 * <pre>
 * public class SaveDeliverRecordHandler extends HandlerTemplate<DeliverRecordContext> {
 *     &#64;Override
 *     protected void doHandle(DeliverRecordContext ctx) {
 *         run(saveAction, ctx);        // 事务内:保存交付需求
 *         run(createFlowAction, ctx);  // 事务内:创建Flow实例
 *         check(validateAction, ctx);  // 非事务:纯校验
 *     }
 * }
 * </pre>
 */
@Component
public abstract class HandlerTemplate<C extends HandlerContext> {

    @Resource
    private OperateLogAction operateLogAction;

    @Resource
    private TransactionTemplate txTemplate;

    @Resource
    private HandlerExceptionHandler handlerExceptionHandler;

    /** 子类实现:代码顺序即执行顺序。 */
    protected abstract void doHandle(C ctx);

    /** 事务内执行一个 Action。run() 内的多个 Action 共享同一事务。 */
    protected final void run(Action<C> action, C ctx) {
        try {
            txTemplate.executeWithoutResult(s -> action.process(ctx));
        } catch (Exception e) {
            handlerExceptionHandler.handle(ctx, e);
        }
    }

    /** 非事务执行(纯校验、幂等判断等不需要回滚的场景)。 */
    protected final void check(Action<C> action, C ctx) {
        action.process(ctx);
    }

    /** 入口:执行 doHandle + 自动追加操作日志。 */
    public final void execute(C ctx) {
        doHandle(ctx);
        operateLogAction.process(ctx);
    }
}
```

### 线性 Handler 示例

```java
package {PACKAGE}.application.{MODULE}.handler;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import {PACKAGE}.application.shared.handler.HandlerTemplate;
import {PACKAGE}.application.shared.handler.Action;
import {PACKAGE}.application.{MODULE}.context.DeliverRecordContext;
import {PACKAGE}.application.{MODULE}.action.SaveDeliverRecordAction;
import {PACKAGE}.application.{MODULE}.action.CreateFlowInstanceAction;
import {PACKAGE}.application.{MODULE}.action.SyncMultiTableAction;
import {PACKAGE}.application.{MODULE}.action.PushFlowNodeAction;

/**
 * 保存交付需求 Handler。
 * 代码顺序即执行顺序:保存 → 创建Flow → 同步 → 推进。
 * 每步 action 由事务包装,异常由基类统一处理。
 */
@Component
public class SaveDeliverRecordHandler extends HandlerTemplate<DeliverRecordContext> {

    @Resource
    private SaveDeliverRecordAction saveAction;
    @Resource
    private CreateFlowInstanceAction createFlowAction;
    @Resource
    private SyncMultiTableAction syncAction;
    @Resource
    private PushFlowNodeAction pushAction;

    @Override
    protected void doHandle(DeliverRecordContext ctx) {
        run(saveAction, ctx);          // 保存交付需求
        run(createFlowAction, ctx);    // 创建Flow实例
        run(syncAction, ctx);          // 同步多维表
        run(pushAction, ctx);          // 推进节点
    }
}
```

### Action 示例

```java
package {PACKAGE}.application.{MODULE}.action;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import {PACKAGE}.application.shared.handler.Action;
import {PACKAGE}.application.{MODULE}.context.DeliverRecordContext;
import {PACKAGE}.domain.{MODULE}.model.DeliverRecord;
import {PACKAGE}.domain.{MODULE}.repository.DeliverRecordRepository;

/**
 * 保存交付需求 Action。
 * 粒度:一次 DB 写入。不做编排,只做一件事。
 */
@Component
public class SaveDeliverRecordAction implements Action<DeliverRecordContext> {

    @Resource
    private DeliverRecordRepository deliverRecordRepository;

    @Override
    public void process(DeliverRecordContext ctx) {
        DeliverRecord record = DeliverRecord.builder()
            .deliverRecordNo(ctx.getDeliverRecordNo())
            .instId(ctx.getInstId())
            .instName(ctx.getInstName())
            .bizCategory(ctx.getBizCategory())
            .status("INIT")
            .creator(ctx.getOperator())
            .build();
        deliverRecordRepository.save(record);
        // 将生成的主键回写到 context,供后续 Action 使用
        ctx.setRecordId(record.getId());
    }
}
```

### Context 示例

```java
package {PACKAGE}.application.{MODULE}.context;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;
import {PACKAGE}.application.shared.handler.HandlerContext;

/**
 * 交付需求 Handler 上下文。
 * @Builder 构建不可变输入,@Setter 仅用于 Action 间的数据传递(如回写 ID)。
 */
@Getter
@Setter
public class DeliverRecordContext extends HandlerContext {

    private final String instId;
    private final String instName;
    private final String bizCategory;

    /** Action 间传递:SaveDeliverRecordAction 写入,后续 Action 读取。 */
    private Long recordId;

    @Builder
    public DeliverRecordContext(String bizNo, String operator,
                                String instId, String instName, String bizCategory) {
        super(bizNo, operator);
        this.instId = instId;
        this.instName = instName;
        this.bizCategory = bizCategory;
    }
}
```

## StatefulHandlerTemplate — 状态机处理模版基类

> **适用场景**:审批回调等有分支路由的写操作。
> 子类只实现 `route()` + `onPass()` / `onReject()` / `onCancel()`,不写 if-else。

```java
package {PACKAGE}.application.shared.handler;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;

/**
 * 状态机处理模版基类。
 *
 * <p>适用场景:审批回调等有分支路由的写操作。子类只实现 route() 决定走哪个分支,
 * 然后覆写 onPass() / onReject() / onCancel() 编排各自的 Action 列表,
 * 基类负责 switch 路由 + 操作日志自动追加,子类不写 if-else。
 *
 * <p>典型用法:
 * <pre>
 * public class StandardPriceSecondStageHandler
 *         extends StatefulHandlerTemplate&lt;PriceContext&gt; {
 *     &#64;Override
 *     protected NodeState route(PriceContext ctx) {
 *         return ctx.getProcessResult();   // PASS / REJECT / CANCEL
 *     }
 *     &#64;Override
 *     protected void onPass(PriceContext ctx) {
 *         run(createComboAction, ctx);
 *         run(createPriceAction, ctx);
 *     }
 * }
 * </pre>
 */
@Component
public abstract class StatefulHandlerTemplate<C extends HandlerContext> {

    @Resource
    private OperateLogAction operateLogAction;

    @Resource
    private TransactionTemplate txTemplate;

    @Resource
    private HandlerExceptionHandler handlerExceptionHandler;

    /** 事务内执行一个 Action。 */
    protected final void run(Action<C> action, C ctx) {
        try {
            txTemplate.executeWithoutResult(s -> action.process(ctx));
        } catch (Exception e) {
            handlerExceptionHandler.handle(ctx, e);
        }
    }

    /** 非事务执行(纯校验、幂等判断等不需要回滚的场景)。 */
    protected final void check(Action<C> action, C ctx) {
        action.process(ctx);
    }

    /** 入口:route() 决定分支 → 各 onXxx() 编排 → 自动追加操作日志。 */
    public final void execute(C ctx) {
        NodeState state = route(ctx);
        switch (state) {
            case NODE_PASS:   onPass(ctx);   break;
            case NODE_REJECT: onReject(ctx); break;
            case NODE_CANCEL: onCancel(ctx); break;
            default:
                throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                    "Unknown route result: " + state);
        }
        operateLogAction.process(ctx);
    }

    /** 判断审批结果,路由到 onPass/onReject/onCancel。 */
    protected abstract NodeState route(C ctx);

    /** 审批通过。 */
    protected void onPass(C ctx) {}

    /** 审批拒绝。 */
    protected void onReject(C ctx) {}

    /** 审批撤销。 */
    protected void onCancel(C ctx) {}
}
```

### 状态机 Handler 示例

```java
package {PACKAGE}.application.{MODULE}.handler;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import {PACKAGE}.application.shared.handler.StatefulHandlerTemplate;
import {PACKAGE}.application.shared.handler.NodeState;
import {PACKAGE}.application.shared.handler.Action;
import {PACKAGE}.application.{MODULE}.context.PriceContext;
import {PACKAGE}.application.{MODULE}.action.CreateProdComboAction;
import {PACKAGE}.application.{MODULE}.action.CreateStandardPriceAction;
import {PACKAGE}.application.{MODULE}.action.PriceProcessRejectAction;
import {PACKAGE}.application.{MODULE}.action.PriceProcessCancelAction;

/**
 * 标准价格审批二阶段 Handler。
 * route() 决定分支 onPass/onReject/onCancel 各自编排 Action。
 */
@Component
public class StandardPriceSecondStageHandler
        extends StatefulHandlerTemplate<PriceContext> {

    @Resource
    private CreateProdComboAction createComboAction;
    @Resource
    private CreateStandardPriceAction createPriceAction;
    @Resource
    private PriceProcessRejectAction rejectAction;
    @Resource
    private PriceProcessCancelAction cancelAction;

    @Override
    protected NodeState route(PriceContext ctx) {
        return ctx.getProcessResult();  // PASS / REJECT / CANCEL
    }

    @Override
    protected void onPass(PriceContext ctx) {
        run(createComboAction, ctx);    // 创建套餐
        run(createPriceAction, ctx);    // 创建标准价格
    }

    @Override
    protected void onReject(PriceContext ctx) {
        run(rejectAction, ctx);
    }

    @Override
    protected void onCancel(PriceContext ctx) {
        run(cancelAction, ctx);
    }
}
```

```java
package {PACKAGE}.application.shared.handler;

/**
 * 节点状态枚举。审批回调的路由结果。
 */
public enum NodeState {
    NODE_PASS,
    NODE_REJECT,
    NODE_CANCEL
}
```

## FacadeImpl 如何调用 Handler

> **两种模式**:
> 1. **简单 CRUD**:FacadeImpl → BizTemplate → Service(不用 Handler)
> 2. **多步编排**:FacadeImpl → BizTemplate → Acceptor → Handler.execute(ctx)

```java
package {PACKAGE}.application.{MODULE}.facade;

import com.alipay.sofa.rpc.api.annotation.RpcProvider;
import org.springframework.beans.factory.annotation.Autowired;
import {PACKAGE}.facade.{MODULE}.{Business}ManageFacade;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}SubmitCommand;
import {PACKAGE}.application.{MODULE}.acceptor.{Business}Acceptor;
import {PACKAGE}.application.{MODULE}.handler.{Business}SubmitHandler;
import {PACKAGE}.application.{MODULE}.context.{Business}Context;
import com.mycm.common.model.base.Result;
import com.mycm.common.component.log.annotation.FacadeIntercept;
import com.mycm.common.component.template.BizTemplate;
import {PACKAGE}.infrastructure.log.MycmLoggerDef;

/**
 * Facade 入口: BizTemplate 兜底 → Acceptor 校验 → Handler 编排。
 */
@RpcProvider
public class {Business}ManageFacadeImpl implements {Business}ManageFacade {

    @Autowired
    private BizTemplate bizTemplate;
    @Autowired
    private {Business}Acceptor {business}Acceptor;
    @Autowired
    private {Business}SubmitHandler {business}SubmitHandler;

    @Override
    @FacadeIntercept(loggerName = MycmLoggerDef.FACADE_SERVICE_LOGGER)
    public Result<Void> submit{Business}({Business}SubmitCommand command) {
        return bizTemplate.doProcess(command, () -> {
            // 1. 业务受理(参数校验 + 状态前置 + 权限判断)
            {business}Acceptor.acceptSubmit(command);
            // 2. 构建 Context + Handler 编排执行
            {Business}Context ctx = {Business}Context.builder()
                .bizNo(command.getBizNo())
                .operator(command.getOperator())
                .build();
            {business}SubmitHandler.execute(ctx);
            return null;
        });
    }
}
```

## 两个常见反模式(在 review 时直接打回)

```java
// ❌ 反模式 1: Handler 里写 if-else 路由代替 StatefulHandlerTemplate
@Component
public class PriceCallbackHandler extends HandlerTemplate<PriceContext> {
    @Override
    protected void doHandle(PriceContext ctx) {
        if ("PASS".equals(ctx.getProcessResult())) {   // ❌ 应该用 StatefulHandlerTemplate
            run(createComboAction, ctx);
            run(createPriceAction, ctx);
        } else if ("REJECT".equals(ctx.getProcessResult())) {
            run(rejectAction, ctx);
        }
        // 缺少 CANCEL 分支,review 时难以发现遗漏
    }
}

// ✅ 正确:用 StatefulHandlerTemplate,编译器强制覆写 onPass/onReject/onCancel

// ❌ 反模式 2: Action 里调 Action,形成隐式调用链
@Component
public class SaveDeliverRecordAction implements Action<DeliverRecordContext> {
    @Resource
    private CreateFlowInstanceAction createFlowAction;  // ❌ Action 不应该注入其他 Action

    @Override
    public void process(DeliverRecordContext ctx) {
        deliverRecordRepository.save(record);
        createFlowAction.process(ctx);  // ❌ 编排是 Handler 的事,不是 Action 的事
    }
}

// ✅ 正确:Handler 做编排,Action 只做一件事
// Handler: run(saveAction, ctx); run(createFlowAction, ctx);
```

> **项目约定覆盖**: 事务策略可能是全部 `run()` 共享一个大事务,也可能是每个 `run()` 独立事务。
> 默认采用每个 `run()` 独立事务(基类实现);如需大事务,在 Handler 内手动使用 `TransactionTemplate`。