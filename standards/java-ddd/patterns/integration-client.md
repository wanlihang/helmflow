# Integration Client Pattern

> When to use: Define an Integration Client when calling external RPC services. The pattern centralizes error handling, result validation, and audit logging for all outbound calls. Never inject the raw RPC facade directly — always go through the client abstraction.

## IntegrationConfig (Infrastructure Layer)

```java
package {PACKAGE}.infrastructure.integration;

import com.alipay.sofa.runtime.api.annotation.RpcConsumer;
import {PACKAGE}.facade.external.{ExternalService}Facade;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;

/**
 * Centralized RPC consumer configuration.
 * All @RpcConsumer references are declared here with explicit timeouts.
 */
@Configuration
public class IntegrationConfig {

    @RpcConsumer(timeout = 5000)
    {ExternalService}Facade {externalService}Facade;

    // Add more RPC consumers as needed
}
```

## FacadeClient Interface (Infrastructure Layer)

```java
package {PACKAGE}.infrastructure.integration.{MODULE};

import com.mycm.common.model.Result;
import {PACKAGE}.facade.external.model.{ExternalDTO};

/**
 * Client interface for calling external {ExternalService}.
 * Decouples application layer from direct RPC facade dependency.
 */
public interface {ExternalService}FacadeClient {

    /**
     * Query {external data} by id.
     */
    Result<{ExternalDTO}> queryById(Long id);

    /**
     * Batch query {external data}.
     */
    Result<List<{ExternalDTO}>> batchQuery(List<Long> ids);
}
```

## FacadeClientImpl (Infrastructure Layer)

```java
package {PACKAGE}.infrastructure.integration.{MODULE}.impl;

import com.mycm.common.model.Result;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import com.mycm.common.component.log.annotation.SalLog;
import com.mycm.common.model.constants.LoggerDef;
import {PACKAGE}.facade.external.{ExternalService}Facade;
import {PACKAGE}.facade.external.model.{ExternalDTO};
import {PACKAGE}.infrastructure.integration.{MODULE}.{ExternalService}FacadeClient;
import com.google.common.base.Preconditions;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * External {ExternalService} client implementation.
 * Wraps RPC calls with result validation and @SalLog audit.
 */
@Slf4j
@Service
public class {ExternalService}FacadeClientImpl implements {ExternalService}FacadeClient {

    @Autowired
    private {ExternalService}Facade {externalService}Facade;

    @Override
    @SalLog(loggerName = LoggerDef.SAL_DETAIL_LOGGER)
    public Result<{ExternalDTO}> queryById(Long id) {
        Result<{ExternalDTO}> result = {externalService}Facade.queryById(id);

        Preconditions.checkNotNull(result, "{ExternalService} returned null result");
        Preconditions.checkState(result.isSuccess(),
            "{ExternalService} call failed: %s", result.getResultMsg());

        return result;
    }

    @Override
    @SalLog(loggerName = LoggerDef.SAL_DETAIL_LOGGER)
    public Result<List<{ExternalDTO}>> batchQuery(List<Long> ids) {
        Result<List<{ExternalDTO}>> result = {externalService}Facade.batchQuery(ids);

        Preconditions.checkNotNull(result, "{ExternalService} returned null result");
        Preconditions.checkState(result.isSuccess(),
            "{ExternalService} batch call failed: %s", result.getResultMsg());

        return result;
    }
}
```

## Usage in Application Service

```java
@Slf4j
@Service
public class {Business}ManageServiceImpl implements {Business}ManageService {

    @Autowired
    private {ExternalService}FacadeClient {externalService}FacadeClient;

    @Override
    @Transactional(rollbackFor = Exception.class)
    public {Business}VO create{Business}({Business}CreateCommand command) {
        // Call external service through client (not raw facade)
        Result<{ExternalDTO}> externalResult = {externalService}FacadeClient.queryById(command.getExternalId());
        // Client already validated: result is non-null and success

        {ExternalDTO} externalData = externalResult.getData();
        // Use external data in business logic
        // ...
    }
}
```

## Rules

- RPC consumer declarations only in IntegrationConfig
- Never use @RpcConsumer outside IntegrationConfig
- Every client method must have @SalLog for audit trail
- Use Preconditions to validate RPC result (null check + success check)
- Application layer injects FacadeClient, never the raw Facade
- Client interface and implementation live in `infrastructure/integration/{module}/`

> **项目约定覆盖**:
> - 命名可能是 FacadeClient/FacadeClientImpl 或 Adapter/AdapterImpl，由 project-conventions.md 确定
> - Preconditions 可能使用 Guava (`com.google.common.base.Preconditions`) 或项目自定义工具类
> - 部分项目不使用 @SalLog，而是手写日志或无审计日志
