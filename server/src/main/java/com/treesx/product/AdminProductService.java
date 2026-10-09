package com.treesx.product;

import jakarta.validation.Validator;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Service @Transactional(readOnly=true)
public class AdminProductService {
    private final ProductRepository products;
    private final PresentationRepository presentations;
    private final CategoryRepository categories;
    private final ObjectMapper mapper;
    private final Validator validator;
    public AdminProductService(ProductRepository products,PresentationRepository presentations,CategoryRepository categories,
                               ObjectMapper mapper,Validator validator) {
        this.products=products; this.presentations=presentations; this.categories=categories; this.mapper=mapper; this.validator=validator;
    }
    static AdminDtos.Item item(ProductEntity p) {
        return new AdminDtos.Item(p.slug,p.name,p.category,p.description,p.cover,p.displayStatus,p.categoryId,p.sortOrder,p.listed,p.revision);
    }
    public List<AdminDtos.Item> list() { return products.findAllByOrderBySortOrderAsc().stream().map(AdminProductService::item).toList(); }
    private ProductEntity product(String slug) {
        return products.findById(slug).orElseThrow(() -> error(HttpStatus.NOT_FOUND,"未找到该商品"));
    }
    public AdminDtos.Detail detail(String slug) {
        ProductEntity p=product(slug);
        var config=presentations.findById(slug).orElseThrow(() -> error(HttpStatus.SERVICE_UNAVAILABLE,"商品展示配置不可用"));
        return new AdminDtos.Detail(item(p),mapper.readValue(config.configJson,Presentation.class));
    }
    public ProductDto preview(AdminDtos.Edit edit) {
        String config=validated(edit);
        var category=categories.findById(edit.categoryId()).orElseThrow(() -> error(HttpStatus.BAD_REQUEST,"请选择有效分类"));
        return new ProductDto(edit.slug(),edit.name().strip(),category.name,edit.description().strip(),edit.cover(),edit.displayStatus(),
            mapper.readValue(config,Presentation.class));
    }
    private String validated(AdminDtos.Edit edit) {
        try {
            if (!validator.validate(edit).isEmpty()) throw new IllegalArgumentException();
            if (edit.cover()!=null && !edit.cover().isBlank()) PresentationV2Validator.local(edit.cover());
            PresentationValidator.validate(edit.presentation(),validator);
            String config=mapper.writeValueAsString(edit.presentation());
            if (config.length()>1024*1024) throw new IllegalArgumentException();
            return config;
        } catch (RuntimeException e) { throw error(HttpStatus.BAD_REQUEST,"展示配置或资源路径无效，请检查引用、动作轨道和字段格式"); }
    }
    static void revision(long actual,long expected) {
        if (actual!=expected) throw error(HttpStatus.CONFLICT,"内容已被其他窗口修改。请重新读取后再保存，当前输入仍保留");
    }
    @Transactional public AdminDtos.Detail save(AdminDtos.Edit edit,boolean create) {
        String config=validated(edit);
        var category=categories.findById(edit.categoryId()).orElseThrow(() -> error(HttpStatus.BAD_REQUEST,"请选择有效分类"));
        ProductEntity p;
        if (create) {
            if (products.existsById(edit.slug())) throw error(HttpStatus.CONFLICT,"商品标识已存在，请使用其他标识");
            p=new ProductEntity(); p.slug=edit.slug(); p.listed=false;
        } else { p=product(edit.slug()); revision(p.revision,edit.revision()); }
        p.name=edit.name().strip(); p.categoryId=category.id; p.category=category.name;
        p.description=edit.description().strip(); p.cover=edit.cover()==null || edit.cover().isBlank()?null:edit.cover();
        p.displayStatus=edit.displayStatus(); p.sortOrder=edit.sortOrder(); p.updatedAt=Instant.now();
        products.saveAndFlush(p);
        var presentation=presentations.findById(p.slug).orElseGet(PresentationEntity::new);
        presentation.slug=p.slug; presentation.schemaVersion=edit.presentation().version(); presentation.configJson=config;
        presentations.saveAndFlush(presentation);
        return new AdminDtos.Detail(item(p),edit.presentation());
    }
    @Transactional public AdminDtos.Item visibility(String slug,AdminDtos.Visibility visibility) {
        var p=product(slug); revision(p.revision,visibility.revision());
        if (visibility.listed()) {
            var detail=detail(slug);
            try { PresentationValidator.validate(detail.presentation(),validator); }
            catch(RuntimeException e) { throw error(HttpStatus.BAD_REQUEST,"展示配置无效，修复后才能上架"); }
        }
        p.listed=visibility.listed(); p.updatedAt=Instant.now();
        return item(products.saveAndFlush(p));
    }
    static ResponseStatusException error(HttpStatus status,String detail) { return new ResponseStatusException(status,detail); }
}
