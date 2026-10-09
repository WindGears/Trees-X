package com.treesx.product;

import jakarta.validation.Validator;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Locale;

@RestController @RequestMapping("/api/v1/products")
public class ProductController {
    private final ProductRepository products;
    private final PresentationRepository presentations;
    private final ObjectMapper mapper;
    private final Validator validator;
    public ProductController(ProductRepository products, PresentationRepository presentations,
                             ObjectMapper mapper, Validator validator) {
        this.products=products; this.presentations=presentations; this.mapper=mapper; this.validator=validator;
    }
    @GetMapping
    public List<ProductDto.Summary> list(@RequestParam(defaultValue="") String q,
                                        @RequestParam(defaultValue="") String category) {
        if (q.length()>120 || category.length()>40)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"搜索内容过长");
        String query=q.strip().toLowerCase(Locale.ROOT);
        return products.findAllByListedTrueOrderBySortOrderAscSlugAsc().stream()
            .filter(p -> p.name.toLowerCase(Locale.ROOT).contains(query))
            .filter(p -> category.isBlank() || p.category.equals(category))
            .map(ProductEntity::summary).toList();
    }
    @GetMapping("/{slug}")
    public ProductDto detail(@PathVariable String slug) {
        ProductEntity product=products.findById(slug)
            .filter(p -> p.listed)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,"未找到该商品"));
        PresentationEntity config=presentations.findById(slug)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"商品展示配置不可用"));
        try {
            Presentation p=mapper.readValue(config.configJson,Presentation.class);
            PresentationValidator.validate(p,validator);
            if (config.schemaVersion != p.version()) throw new IllegalArgumentException();
            return new ProductDto(product.slug,product.name,product.category,product.description,product.cover,product.displayStatus,p);
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"商品展示配置不可用");
        }
    }
}
