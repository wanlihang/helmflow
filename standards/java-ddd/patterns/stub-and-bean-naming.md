# Stub Implementation & Bean Naming Pattern

> **When to use**:任何时候你声明了一个 Spring 管理的 `interface`、`@Component`、`@Service`、`@Repository`,
> 都要按本 pattern 检查"装配期能否跑起来"。`mvn compile` / `mvn package` 通过 ≠ 应用能启动 ——
> bean 装配链只在 `ApplicationContext.refresh()` 时才走完。
>
> **解决三个真实事故**:
> 1. 接口在 domain 层只有 `interface`,没有 `Impl`,IDE 启动期才报 `NoSuchBeanDefinitionException`
> 2. 跨 context 同名 Action(如 `pricing.ProdOnlineUpdateAction` 和 `signing.QtFusionProdOnlineUpdateAction`
>    默认 bean 名都含 `prodOnlineUpdateAction`),`@Resource` 按字段名匹配跨了 bounded context
> 3. stub 占位写法不统一(有的抛 `IllegalStateException`、有的抛 `MycmSysException`、有的接口干脆没实现),
>    AI 学旧代码风格时随机选,导致传染
>
> **配套**:
> - `core/init-java-ddd/templates/app/test/BootContextSmokeTest.java.tmpl` 在 `mvn test` 阶段拦截
> - `standards/java-ddd/review-rules.md` §I 是 PR 审查规则
> - `core/init-java-ddd/SKILL.md` 反模式 #12 / #13 / #14

---

## 规则 1:接口必须配 stub @Service 实现

每声明一个 Spring 管理的 `interface`(`XxxService` / `XxxRepository` / 其他 bean 接口),
**同一 commit 内**必须落对应的 `XxxServiceImpl` / `XxxRepositoryImpl`,即使逻辑还没对接。

### ✅ 正确:接口与 stub impl 同时落

```java
// domain/{context}/service/PriceValidationService.java
package {PACKAGE}.domain.{context}.service;

public interface PriceValidationService {
    void validateConfig(String priceNo, String configJson);
}
```

```java
// domain/{context}/service/impl/PriceValidationServiceImpl.java
package {PACKAGE}.domain.{context}.service.impl;

import com.mycm.common.model.exception.MycmSysException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import org.springframework.stereotype.Service;
import {PACKAGE}.domain.{context}.service.PriceValidationService;

/**
 * Stub 实现:让 ApplicationContext 装得起来,真正逻辑后续对接时替换。
 * 不允许只有 interface 没有 @Service 实现 —— 启动期会报
 * NoSuchBeanDefinitionException,见 review-rules §I-1。
 */
@Service
public class PriceValidationServiceImpl implements PriceValidationService {

    @Override
    public void validateConfig(String priceNo, String configJson) {
        throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR,
            "PriceValidationService#validateConfig 待对接");
    }
}
```

### ❌ 错误:只有 interface,无实现类

```java
// 仅有 interface,没有 @Service 实现
public interface PriceValidationService { ... }
```

**为什么编译过、启动炸**:`@Resource private PriceValidationService priceValidationService;` 在
其他 bean 装配时会按 type 找,找不到任何 candidate → `NoSuchBeanDefinitionException`。
`mvn compile` 不跑 bean 装配,所以编译期发现不了。

### 例外

只有这一种情况允许 interface 不立刻配 impl:**接口由外部 jar(如 SOFA RPC consumer)注入**,
此时 bean 由 `<sofa:reference>` 或 `@RpcConsumer` 装配。这种情况要在 interface 上方写注释明示来源:

```java
/**
 * Bean 由 @RpcConsumer 装配,不需要本工程提供 Impl。
 * @see {PACKAGE}.infrastructure.config.SomeRpcConfig
 */
public interface ExternalSomeService { ... }
```

---

## 规则 2:跨 context 同名 Bean 必须显式命名

### 触发场景

```
application/pricing/action/ProdOnlineUpdateAction.java        → 默认 bean 名 prodOnlineUpdateAction
application/signing/action/QtFusionProdOnlineUpdateAction.java → 默认 bean 名 qtFusionProdOnlineUpdateAction
```

不同 context 下的类名前缀不同时**默认 bean 名不冲突**,但常见的"忘记加 context 前缀的简化命名"
(`pricing.ProdOnlineUpdateAction` 和 `signing.ProdOnlineUpdateAction`)会让两个 `@Component`
默认 bean 名都是 `prodOnlineUpdateAction` —— Spring 启动期 `BeanDefinitionOverrideException`,
或更隐蔽地,`@Resource` 按字段名匹配命中错 bean,跨了 bounded context。

### ✅ 正确:`@Component` 显式命名 + `@Resource(name=)` 显式匹配

```java
// pricing 侧
@Component("pricingProdOnlineUpdateAction")
public class ProdOnlineUpdateAction implements Action<PriceContext> { ... }

// signing 侧(即使类全名不同,也加显式名,保持风格一致)
@Component("signingProdOnlineUpdateAction")
public class QtFusionProdOnlineUpdateAction implements Action<SigningContext> { ... }

// 引用方
@Resource(name = "pricingProdOnlineUpdateAction")
private Action<PriceContext> prodOnlineUpdateAction;
```

### 命名规则

| 类型 | 命名模板 | 示例 |
|------|---------|------|
| `@Component` 显式名 | `{context}{ShortClassName}`(小驼峰,context 前缀) | `pricingProdOnlineUpdateAction` |
| `@Resource(name=)` | 同上,**必须**与目标 bean 显式名完全一致 | `@Resource(name = "pricingProdOnlineUpdateAction")` |

### 触发显式命名的硬条件(满足任一即必须)

1. 同一类名(去除 context 前缀后)在两个或更多 context 中出现
2. 类名是常见动词命名(`UpdateXxx` / `SaveXxx` / `CreateXxx`),易撞名
3. 该 bean 被多个 context 引用(跨上下文复用)

不满足以上三条的 `@Component` 可继续用默认 bean 名(就是首字母小写的类名)。

### ❌ 错误:依赖默认 bean 名 + 字段名匹配

```java
@Component  // 默认 bean 名 prodOnlineUpdateAction
public class ProdOnlineUpdateAction implements Action<PriceContext> { ... }

// 引用方 — 按字段名匹配,撞到 signing 的同名 bean 也无感知
@Resource
private Action<PriceContext> prodOnlineUpdateAction;
```

---

## 规则 3:Stub 占位统一写法

新代码占位 / 待对接逻辑 **只允许一种写法**——`throw new MycmSysException(SYSTEM_INNER_ERROR, "...待对接")`,
不允许 `IllegalStateException` / `IllegalArgumentException` / `UnsupportedOperationException` / 默认返回 `null`。

### ✅ 正确

```java
@Service
public class DeliverRecordStatusServiceImpl implements DeliverRecordStatusService {

    @Override
    public void transitToReleased(String deliverRecordNo) {
        throw new MycmSysException(ErrorCodeEnum.SYSTEM_INNER_ERROR,
            "DeliverRecordStatusService#transitToReleased 待对接");
    }
}
```

### ❌ 错误的占位

```java
// ❌ 反例 1: 抛 JDK 异常 — 跳过 ErrorCodeEnum + MycmBizException 体系,
// 调用方拿不到错误码,日志/告警链路丢失
throw new IllegalStateException("not implemented");

// ❌ 反例 2: 抛 IllegalArgumentException —— 这是参数错误的语义,占位用就语义错位
throw new IllegalArgumentException("TODO");

// ❌ 反例 3: 直接 return null —— 调用方拿到 null 后 NPE,排查路径远长于 stub 抛错
return null;

// ❌ 反例 4: 接口干脆不写实现 —— 见规则 1
```

### 为什么必须 `MycmSysException(SYSTEM_INNER_ERROR, "{Class}#{method} 待对接")`

1. 走 BizTemplate 的统一异常通道,Result.fail(errorCode, msg) 自动包装,调用方拿到结构化错误
2. `@FacadeIntercept` 自动打 SYS-FACADE 日志,告警链路天然接上
3. 异常 message 包含 `{Class}#{method}` —— 排查时一眼定位是哪个 stub 没对接
4. **统一信号**让 AI 在生成新代码时只学一种风格,不会被混合反例传染

---

## 关联

- **审查规则**:`review-rules.md` §I 装配风险(I-1 接口缺 stub / I-2 跨 context 未显式命名 / I-3 抛 JDK 异常 / I-4 占位写法不统一)
- **拦截方式**:`core/init-java-ddd/templates/app/test/BootContextSmokeTest.java.tmpl`(在 `mvn test` 跑应用启动)
- **反模式**:`core/init-java-ddd/SKILL.md` 反模式 #12 / #13 / #14
- **memory**:[[feedback-interface-must-have-stub-impl]] / [[feedback-cross-context-bean-naming]] / [[feedback-stub-placeholder-style-unified]]
