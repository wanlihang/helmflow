# Application Service Pattern

> When to use: Define an Application Service to orchestrate use cases by coordinating domain objects and infrastructure. It is the ONLY place where `@Transactional` belongs. Follow the 5-step pattern: validate input, build domain object, call domain method, persist, return result.

## Application Service Interface

```java
package {PACKAGE}.application.{MODULE}.service;

import {PACKAGE}.facade.{MODULE}.model.command.{Business}CreateCommand;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}UpdateCommand;
import {PACKAGE}.facade.{MODULE}.model.query.{Business}Query;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.Paginator;

/**
 * {Business} application service interface.
 */
public interface {Business}ManageService {

    /**
     * Create a {business}.
     */
    {Business}VO create{Business}({Business}CreateCommand command);

    /**
     * Update a {business}.
     */
    {Business}VO update{Business}({Business}UpdateCommand command);

    /**
     * Cancel a {business}.
     */
    void cancel{Business}(Long id);
}
```

```java
package {PACKAGE}.application.{MODULE}.service;

import {PACKAGE}.facade.{MODULE}.model.query.{Business}Query;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.Paginator;

/**
 * {Business} query service interface.
 */
public interface {Business}QueryService {

    /**
     * Query {business} by id.
     */
    {Business}VO query{Business}(Long id);

    /**
     * Paginate {business} list.
     */
    Paginator<{Business}VO> list{Business}({Business}Query query);
}
```

## Application Service Implementation (5-Step Pattern)

```java
package {PACKAGE}.application.{MODULE}.service.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.Assert;
import {PACKAGE}.application.{MODULE}.service.{Business}ManageService;
import {PACKAGE}.application.{MODULE}.builder.{Business}AggregatorBuilder;
import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.domain.{MODULE}.model.{Business}Aggregator;
import {PACKAGE}.domain.{MODULE}.model.{Business}StatusEnum;
import {PACKAGE}.domain.{MODULE}.repository.{Business}Repository;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}CreateCommand;
import {PACKAGE}.facade.{MODULE}.model.command.{Business}UpdateCommand;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import com.mycm.common.util.LoggerUtil;

/**
 * {Business} manage service implementation.
 * Uses @Service + @Transactional.
 * Follows the 5-step pattern: validate -> build -> call domain -> persist -> return.
 */
@Slf4j
@Service
public class {Business}ManageServiceImpl implements {Business}ManageService {

    @Autowired
    private {Business}Repository {business}Repository;

    @Autowired
    private {Business}AggregatorBuilder {business}AggregatorBuilder;

    /**
     * Create {business} — 5-step pattern.
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public {Business}VO create{Business}({Business}CreateCommand command) {
        // Step 1: Validate
        Assert.notNull(command, "command must not be null");
        Assert.hasText(command.get{Business}No(), "{business}No is required");
        validate{Business}NoUnique(command.get{Business}No());

        // Step 2: Build domain object
        {Business}Aggregator aggregator = {business}AggregatorBuilder.buildFromCommand(command);

        // Step 3: Call domain method
        aggregator.submit();

        // Step 4: Persist
        {business}Repository.saveAggregator(aggregator);

        // Step 5: Return
        LoggerUtil.info(log, "BIZ-SERVICE-LOGGER|create{Business}|id={}|no={}",
            aggregator.getId(), aggregator.get{Business}No());
        return convertToVO(aggregator);
    }

    /**
     * Update {business} — 5-step pattern.
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public {Business}VO update{Business}({Business}UpdateCommand command) {
        // Step 1: Validate
        Assert.notNull(command, "command must not be null");
        Assert.notNull(command.getId(), "id is required");

        // Step 2: Build / Load domain object
        {Business}Aggregator aggregator = {business}AggregatorBuilder
            .rebuildFromPersistence(command.getId());

        // Step 3: Call domain method
        if (command.getRemark() != null) {
            aggregator.setRemark(command.getRemark());
        }

        // Step 4: Persist
        {business}Repository.saveAggregator(aggregator);

        // Step 5: Return
        LoggerUtil.info(log, "BIZ-SERVICE-LOGGER|update{Business}|id={}",
            aggregator.getId());
        return convertToVO(aggregator);
    }

    /**
     * Cancel {business} — 5-step pattern.
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public void cancel{Business}(Long id) {
        // Step 1: Validate
        Assert.notNull(id, "id must not be null");

        // Step 2: Load domain object
        {Business}Aggregator aggregator = {business}AggregatorBuilder
            .rebuildFromPersistence(id);

        // Step 3: Call domain method
        aggregator.cancel("Cancelled by user");

        // Step 4: Persist
        {business}Repository.saveAggregator(aggregator);

        // Step 5: Return (void in this case)
        LoggerUtil.info(log, "BIZ-SERVICE-LOGGER|cancel{Business}|id={}", id);
    }

    // ---------- Private Helpers ----------

    private void validate{Business}NoUnique(String {business}No) {
        {Business}Entity existing = {business}Repository.findBy{Business}No({business}No);
        if (existing != null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "{Business}No already exists: " + {business}No);
        }
    }

    private {Business}VO convertToVO({Business}Aggregator aggregator) {
        {Business}VO vo = new {Business}VO();
        vo.setId(aggregator.getId());
        vo.set{Business}No(aggregator.get{Business}No());
        vo.setStatus(aggregator.getStatus().getCode());
        vo.setStatusDescription(aggregator.getStatus().getDescription());
        vo.setRemark(aggregator.getRemark());
        return vo;
    }
}
```

## Query Service Implementation (Read-Only Transaction)

```java
package {PACKAGE}.application.{MODULE}.service.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.Assert;
import {PACKAGE}.application.{MODULE}.service.{Business}QueryService;
import {PACKAGE}.domain.{MODULE}.model.{Business}Entity;
import {PACKAGE}.domain.{MODULE}.model.{Business}Aggregator;
import {PACKAGE}.domain.{MODULE}.repository.{Business}Repository;
import {PACKAGE}.facade.{MODULE}.model.query.{Business}Query;
import {PACKAGE}.facade.{MODULE}.model.vo.{Business}VO;
import com.mycm.common.model.Paginator;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;

/**
 * {Business} query service implementation.
 * Uses @Transactional(readOnly = true) for read operations.
 */
@Slf4j
@Service
public class {Business}QueryServiceImpl implements {Business}QueryService {

    @Autowired
    private {Business}Repository {business}Repository;

    @Override
    @Transactional(readOnly = true)
    public {Business}VO query{Business}(Long id) {
        Assert.notNull(id, "id must not be null");

        {Business}Aggregator aggregator = {business}Repository.findAggregatorById(id);
        if (aggregator == null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "{Business} not found: " + id);
        }

        return convertToVO(aggregator);
    }

    @Override
    @Transactional(readOnly = true)
    public Paginator<{Business}VO> list{Business}({Business}Query query) {
        Assert.notNull(query, "query must not be null");
        // Query logic with pagination — delegate to repository
        // ... implementation uses repository query methods ...
        return new Paginator<>();
    }

    private {Business}VO convertToVO({Business}Aggregator aggregator) {
        {Business}VO vo = new {Business}VO();
        vo.setId(aggregator.getId());
        vo.set{Business}No(aggregator.get{Business}No());
        vo.setStatus(aggregator.getStatus().getCode());
        vo.setStatusDescription(aggregator.getStatus().getDescription());
        vo.setRemark(aggregator.getRemark());
        return vo;
    }
}
```

## Scheduler with @Scheduled + Logging + Exception Handling

```java
package {PACKAGE}.application.{MODULE}.scheduler;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import {PACKAGE}.domain.{MODULE}.model.{Business}StatusEnum;
import {PACKAGE}.domain.{MODULE}.repository.{Business}Repository;
import com.mycm.common.util.LoggerUtil;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;

import java.util.List;

/**
 * {Business} scheduler for timed tasks.
 * Uses @Scheduled + @Component.
 * Every scheduled method MUST have try-catch with logging to prevent
 * one failure from killing the scheduler thread.
 */
@Slf4j
@Component
public class {Business}Scheduler {

    @Autowired
    private {Business}Repository {business}Repository;

    /**
     * Timeout scanning: find PROCESSING records older than threshold and mark FAILED.
     * Runs every 5 minutes.
     */
    @Scheduled(fixedDelay = 300000)
    public void scanTimeout() {
        LoggerUtil.info(log, "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|start");
        long startTime = System.currentTimeMillis();

        try {
            List<Long> timeoutIds = {business}Repository
                .findTimeoutIds({Business}StatusEnum.PROCESSING.getCode(), 30);

            if (timeoutIds.isEmpty()) {
                LoggerUtil.info(log, "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|noTimeouts");
                return;
            }

            LoggerUtil.info(log, "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|count={}",
                timeoutIds.size());

            int successCount = 0;
            int failCount = 0;

            for (Long id : timeoutIds) {
                try {
                    markAsFailed(id);
                    successCount++;
                } catch (Exception e) {
                    failCount++;
                    LoggerUtil.error(log,
                        "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|fail|id={}", id, e);
                    // Continue processing remaining items
                }
            }

            long elapsed = System.currentTimeMillis() - startTime;
            LoggerUtil.info(log,
                "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|done|total={}|success={}|fail={}|elapsed={}ms",
                timeoutIds.size(), successCount, failCount, elapsed);

        } catch (Exception e) {
            // Top-level catch: prevent scheduler thread death
            long elapsed = System.currentTimeMillis() - startTime;
            LoggerUtil.error(log,
                "MONITOR-LOGGER|{Business}Scheduler|scanTimeout|error|elapsed={}ms",
                elapsed, e);
        }
    }

    /**
     * Daily report: aggregate completed records for the previous day.
     * Runs at 02:00 AM every day.
     */
    @Scheduled(cron = "0 0 2 * * ?")
    public void dailyReport() {
        LoggerUtil.info(log, "MONITOR-LOGGER|{Business}Scheduler|dailyReport|start");
        long startTime = System.currentTimeMillis();

        try {
            // Generate daily report logic
            // ...

            long elapsed = System.currentTimeMillis() - startTime;
            LoggerUtil.info(log,
                "MONITOR-LOGGER|{Business}Scheduler|dailyReport|done|elapsed={}ms", elapsed);

        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - startTime;
            LoggerUtil.error(log,
                "MONITOR-LOGGER|{Business}Scheduler|dailyReport|error|elapsed={}ms",
                elapsed, e);
        }
    }

    // ---------- Private Helpers ----------

    private void markAsFailed(Long id) {
        var aggregator = {business}Repository.findAggregatorById(id);
        if (aggregator == null) {
            LoggerUtil.warn(log,
                "MONITOR-LOGGER|{Business}Scheduler|markAsFailed|notFound|id={}", id);
            return;
        }
        aggregator.cancel("Timed out by scheduler");
        {business}Repository.saveAggregator(aggregator);
    }
}
```