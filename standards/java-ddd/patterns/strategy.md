# Strategy Pattern

> When to use: Apply the Strategy pattern when a behavior has multiple implementations selected at runtime based on a type discriminator. Each strategy is a Spring `@Component`; a Factory auto-registers them via `@Autowired List<>` + `@PostConstruct`.

## Strategy Interface

```java
package {PACKAGE}.domain.{MODULE}.strategy;

/**
 * Strategy interface for {business} processing.
 * Each implementation handles a specific type.
 */
public interface {Business}ProcessStrategy {

    /**
     * Return the type this strategy handles.
     * Used by the factory for auto-registration and lookup.
     */
    String getType();

    /**
     * Process the {business} according to this strategy's rules.
     */
    void process({Business}ProcessContext context);

    /**
     * Check if this strategy supports the given type.
     * Default implementation matches by getType().
     */
    default boolean supports(String type) {
        return getType().equals(type);
    }
}
```

## Strategy Context

```java
package {PACKAGE}.domain.{MODULE}.strategy;

import lombok.Data;
import java.io.Serializable;

/**
 * Context object passed to strategies.
 */
@Data
public class {Business}ProcessContext implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long {business}Id;
    private String type;
    private Object payload;
}
```

## Strategy Implementation A

```java
package {PACKAGE}.domain.{MODULE}.strategy.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessStrategy;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessContext;

/**
 * Strategy for type = "STANDARD".
 */
@Slf4j
@Component
public class Standard{Business}ProcessStrategy implements {Business}ProcessStrategy {

    private static final String TYPE = "STANDARD";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public void process({Business}ProcessContext context) {
        log.info("BIZ-SERVICE-LOGGER|Standard{Business}Process|{business}Id={}",
            context.get{Business}Id());
        // Standard processing logic
    }
}
```

## Strategy Implementation B

```java
package {PACKAGE}.domain.{MODULE}.strategy.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessStrategy;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessContext;

/**
 * Strategy for type = "PRIORITY".
 */
@Slf4j
@Component
public class Priority{Business}ProcessStrategy implements {Business}ProcessStrategy {

    private static final String TYPE = "PRIORITY";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public void process({Business}ProcessContext context) {
        log.info("BIZ-SERVICE-LOGGER|Priority{Business}Process|{business}Id={}",
            context.get{Business}Id());
        // Priority processing logic (e.g., expedited handling)
    }
}
```

## Strategy Implementation C

```java
package {PACKAGE}.domain.{MODULE}.strategy.impl;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessStrategy;
import {PACKAGE}.domain.{MODULE}.strategy.{Business}ProcessContext;

/**
 * Strategy for type = "BATCH".
 */
@Slf4j
@Component
public class Batch{Business}ProcessStrategy implements {Business}ProcessStrategy {

    private static final String TYPE = "BATCH";

    @Override
    public String getType() {
        return TYPE;
    }

    @Override
    public void process({Business}ProcessContext context) {
        log.info("BIZ-SERVICE-LOGGER|Batch{Business}Process|{business}Id={}",
            context.get{Business}Id());
        // Batch processing logic
    }
}
```

## Strategy Factory with @Autowired List<> + @PostConstruct Auto-Registration

```java
package {PACKAGE}.domain.{MODULE}.strategy;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.mycm.common.model.exception.MycmBizException;
import com.mycm.common.model.exception.ErrorCodeEnum;
import {PACKAGE}.domain.{MODULE}.strategy.impl.*;

import javax.annotation.PostConstruct;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Factory that auto-discovers all {Business}ProcessStrategy beans
 * and registers them by type. No manual registration needed.
 *
 * Adding a new strategy only requires creating a new @Component class
 * that implements {Business}ProcessStrategy.
 */
@Slf4j
@Component
public class {Business}ProcessStrategyFactory {

    /** All strategy beans injected by Spring. */
    @Autowired
    private List<{Business}ProcessStrategy> strategies;

    /** Type -> Strategy lookup map, built at startup. */
    private final Map<String, {Business}ProcessStrategy> strategyMap = new HashMap<>();

    /**
     * Auto-register all strategies after Spring injection.
     */
    @PostConstruct
    public void init() {
        for ({Business}ProcessStrategy strategy : strategies) {
            String type = strategy.getType();
            if (strategyMap.containsKey(type)) {
                throw new IllegalStateException(
                    "Duplicate strategy type: " + type
                        + ", existing=" + strategyMap.get(type).getClass().getName()
                        + ", duplicate=" + strategy.getClass().getName());
            }
            strategyMap.put(type, strategy);
            log.info("BIZ-SERVICE-LOGGER|StrategyRegistered|type={}|impl={}",
                type, strategy.getClass().getSimpleName());
        }
        log.info("BIZ-SERVICE-LOGGER|StrategyFactoryInit|total={}", strategyMap.size());
    }

    /**
     * Get strategy by type. Throws if type is unknown.
     */
    public {Business}ProcessStrategy getStrategy(String type) {
        {Business}ProcessStrategy strategy = strategyMap.get(type);
        if (strategy == null) {
            throw new MycmBizException(ErrorCodeEnum.BIZ_ERROR,
                "No strategy found for type: " + type);
        }
        return strategy;
    }
}
```

## Usage in Domain Service or Application Service

```java
// Inject the factory
@Autowired
private {Business}ProcessStrategyFactory strategyFactory;

// Use it
public void process{Business}({Business}ProcessContext context) {
    {Business}ProcessStrategy strategy = strategyFactory.getStrategy(context.getType());
    strategy.process(context);
}
```