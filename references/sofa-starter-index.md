# SOFA Starter 索引

`init-java-ddd` 骨架引入的 SOFABoot starter 全集。每个 starter 的「该装在哪个模块」是约束,不要随意挪动。

## bootstrap 模块(应用入口聚合)

| Starter                                           | 作用                                  | 备注                                                      |
|---------------------------------------------------|-------------------------------------|---------------------------------------------------------|
| `actuator-alipay-sofa-boot-starter`               | Actuator 端点 (`/actuator/health` 等)  | 探活必备                                                    |
| `healthcheck-alipay-sofa-boot-starter`            | SOFABoot 健康检查扩展                     | k8s readinessProbe 依赖它                                  |
| `infra-alipay-sofa-boot-starter`                  | 基础设施扩展(模块隔离、Bean 优先级等)             | 必装                                                      |
| `runtime-alipay-sofa-boot-starter`                | SOFA Runtime 支撑(`@SofaReference` 等) | 注意:bootstrap 与 application 都依赖,但只在 bootstrap 引入 starter |
| `test-alipay-sofa-boot-starter`                   | 单元测试支撑                              | scope=test                                              |

## web 模块(HTTP 入口)

| Starter                                       | 作用                          |
|-----------------------------------------------|-----------------------------|
| `web-alipay-sofa-boot-starter`                | Web MVC + Tomcat,提供 HTTP 入口 |
| `buservice-alipay-sofa-boot-starter`          | 业务服务装配(buservice)           |
| `alipay-security-core`                        | 安全核心(XSS / 跨站等)             |

## application 模块(对外契约 + 编排)

| Starter                              | 作用                       |
|--------------------------------------|--------------------------|
| `rpc-alipay-sofa-boot-starter`       | SOFA RPC,提供 `@RpcProvider` |
| `mapstruct`                          | 对象转换(VO/DTO/Domain)      |

## domain 模块

| Starter                                       | 作用              |
|-----------------------------------------------|-----------------|
| `spring-boot-starter-web`                     | 提供 servlet API 等通用工具,不为暴露 HTTP |
| `runtime-alipay-sofa-boot-starter`            | 为 `@SofaReference` 注入领域内的 RPC 引用做准备 |
| `spring-boot-starter-test` (test)             | 领域服务的单元测试                          |

## infrastructure 模块

| Starter                                | 作用                              |
|----------------------------------------|---------------------------------|
| `ddcs-alipay-sofa-boot-starter`        | 配置中心(动态配置 + 灰度)                |
| `dds-alipay-sofa-boot-starter`         | 数据源声明(配合 ZDAL)                  |
| `mist-alipay-sofa-boot-starter`        | MIST/AntKMS 密钥管理                |
| `mq-alipay-sofa-boot-starter`          | 消息队列(MetaQ)                     |
| `scheduler-alipay-sofa-boot-starter`   | 分布式任务调度                         |
| `zdal-orm-annotation`                  | ZDAL ORM 注解                     |
| `mybatis-spring-boot-starter`          | MyBatis 集成                      |

## 常见踩坑

1. **`mist-alipay-sofa-boot-starter` 放错模块**:它属于 infrastructure(密钥管理),不应放 web/application。
2. **缺 `runtime-alipay-sofa-boot-starter`**:出现 `@SofaReference` 不生效、`MissingBeanDefinitionException`,99% 是漏装。
3. **dds + zdal 版本不匹配**:`sofa.boot.dds.version` 必须与 `ZdalDataSourceBuilder.version(...)` 中的 EI 号一致,否则启动时连不上 DBMesh。
4. **mybatis-spring-boot-starter 与 zdal 冲突**:不要再额外引 `mybatis-plus`,否则 SqlSessionFactory 会出现两套定义。
