package com.treesx.product;
import org.springframework.dao.*;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.converter.HttpMessageNotReadableException;

@RestControllerAdvice
public class AdminErrors {
    @ExceptionHandler({ObjectOptimisticLockingFailureException.class})
    public ProblemDetail conflict(Exception e) { return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,"内容已被其他窗口修改，请重新读取后再保存"); }
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail integrity(Exception e) { return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,"名称或标识重复，或内容仍被引用"); }
    @ExceptionHandler({MethodArgumentNotValidException.class,HttpMessageNotReadableException.class})
    public ProblemDetail invalid(Exception e) { return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,"输入格式不正确，请检查必填项、数值范围和展示配置"); }
}
