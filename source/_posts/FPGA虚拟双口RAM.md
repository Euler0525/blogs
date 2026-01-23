---
title: FPGA虚拟双口RAM
tags:
  - FPGA
  - 资源优化
categories: 编程
abbrlink: 17b77acf
date: 2025-07-16 20:21:30
---

> 给一段波形加发送时延，可以将其存储到 BRAM IP 核中，读地址比写地址晚响应的延迟采样点数（BRAM 深度足够，即大于延迟采样点数），就达到了延迟的效果。对于常有效的信号波形来说这么做是可以的。但是对于只有在某几个时刻有效的信号来说，仍采用这种办法缓存，BRAM 中存储的大多数数据是无效的，浪费了很多 BRAM 资源。

本文采用的办法是“虚拟”的 RAM，读地址与写地址的关系不变，虚拟的写地址始终累加，虚拟的读地址延迟相应的采样点数。但是数据不写入 RAM 中，而是在数据有效时写入一个寄存器，并且标记对应的虚拟写地址为真实的读地址，当虚拟的读地址为真实读地址时从寄存器中读出数据。（testbench 见附录）

如下图所示，数据 `data` 只有当 `valid` 拉高时有效，于是按照上述逻辑对 `data` 和 `valid` 信号延迟，当 `...dout_valid` 拉高时表示数据延迟了 $100$ 个采样点。

![](https://cdn.jsdelivr.net/gh/Euler0525/tube/prog/verilog_virtual_ram_ex.webp)

---

特别感谢罗老师的耐心细致的讲解！

## 附录

```verilog
`timescale 1ns / 1ps


module testbench();
    reg  clk   = 1'b1;
    reg  rst   = 1'b1;
    reg  rst_n = 1'b0;

    localparam CLOCK_PERIOD = 8.138;
    always #(CLOCK_PERIOD/2) clk = ~clk;  // 122.88MHz

    initial begin
        #8.138;
        rst   <= 1'b0;
        rst_n <= 1'b1;
    end

////////////////////////////////////////////////////////////////////////////////
    reg  [11:0] data;
    reg         valid;

    reg  [5:0] cnter;
    always @(posedge clk) begin
        if (rst) begin
            cnter <= 6'd0;
        end else begin
            cnter <= cnter + 6'd1;
        end
    end

    // Suppose the data signal remains unchanged each time
    // the valid signal is raised
    always @(posedge clk) begin
        if (rst) begin
            valid <= 1'b0;
        end else begin
            if (cnter == 6'd46) begin
                valid <= 1'b1;
            end else begin
                valid <= 1'b0;
            end
        end
    end

    reg  [11:0] data_buf;
    always @(posedge clk) begin
        if (rst) begin
            data_buf <= 12'd0;
            data     <= 12'd0;
        end else begin
            if (cnter == 6'd47) begin
                data_buf <= data;
                data     <= 12'd0;
            end else if (cnter == 6'd63) begin
                data_buf <= data_buf;
                data     <= data_buf + 12'd1;
            end
        end
    end

    reg  [7:0] delay = 8'd100;
////////////////////////////////////////////////////////////////////////////////
    wire virtual_dual_ram_din_valid;
    reg  virtual_dual_ram_dout_valid;
    assign virtual_dual_ram_din_valid = valid;

    wire [11:0] virtual_dual_ram_din;
    reg  [11:0] virtual_dual_ram_dout;
    assign virtual_dual_ram_din = data;

    reg  [7:0] virtual_dual_ram_waddr;
    wire [7:0] virtual_dual_ram_raddr;
    always @(posedge clk) begin
        if (rst) begin
            virtual_dual_ram_waddr <= 18'd0;
        end else begin
            virtual_dual_ram_waddr <= virtual_dual_ram_waddr + 18'd1;
        end
    end

    addsub0808 addsub0808_inst (
        .ADD ( 1'b0                    ),  // 1 - add, 0 - sub
        .A   ( virtual_dual_ram_waddr  ),  // input  [7:0] A
        .B   ( delay                   ),  // input  [7:0] B
        .S   ( virtual_dual_ram_raddr  )   // output [7:0] S
    );


    // Virtual Dual RAM(Depth = 4)
    reg  [11:0] virtual_dual_ram_00 = 12'd0;
    reg  [11:0] virtual_dual_ram_01 = 12'd0;
    reg  [11:0] virtual_dual_ram_02 = 12'd0;
    reg  [11:0] virtual_dual_ram_03 = 12'd0;

    reg  [7:0]  delay_raddr_real_00 = 8'd0;
    reg  [7:0]  delay_raddr_real_01 = 8'd0;
    reg  [7:0]  delay_raddr_real_02 = 8'd0;
    reg  [7:0]  delay_raddr_real_03 = 8'd0;


    reg  [1:0] delay_wr_state      = 2'd0;
    reg  [1:0] delay_wr_next_state = 2'd0;

    // 1. update state
    always @(posedge clk) begin
        if (rst) begin
            delay_wr_state <= 2'd0;
        end else begin
            delay_wr_state <= delay_wr_next_state;
        end
    end

    // 2. update next_state
    reg  virtual_dual_ram_din_valid_d1;
    always @(posedge clk) begin
        if (rst) begin
            virtual_dual_ram_din_valid_d1 <= 1'b0;
        end else begin
            virtual_dual_ram_din_valid_d1 <= virtual_dual_ram_din_valid;
        end
    end

    always @(*) begin
        case (delay_wr_state)
            2'd0: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    delay_wr_next_state = 2'd1;
                end else begin
                    delay_wr_next_state = 2'd0;
                end
            end
            2'd1: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    delay_wr_next_state = 2'd2;
                end else begin
                    delay_wr_next_state = 2'd1;
                end
            end
            2'd2: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    delay_wr_next_state = 2'd3;
                end else begin
                    delay_wr_next_state = 2'd2;
                end
            end
            2'd3: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    delay_wr_next_state = 2'd0;
                end else begin
                    delay_wr_next_state = 2'd3;
                end
            end
        endcase
    end

    // 3. Write virtual dual RAM
    always @(posedge clk) begin
        case (delay_wr_state)
            2'd0: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    virtual_dual_ram_00 <= virtual_dual_ram_din[11:0];
                    delay_raddr_real_00 <= virtual_dual_ram_waddr;
                end else begin
                    virtual_dual_ram_00 <= virtual_dual_ram_00;
                    delay_raddr_real_00 <= delay_raddr_real_00;
                end
            end
            2'd1: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    virtual_dual_ram_01 <= virtual_dual_ram_din[11:0];
                    delay_raddr_real_01 <= virtual_dual_ram_waddr;
                end else begin
                    virtual_dual_ram_01 <= virtual_dual_ram_01;
                    delay_raddr_real_01 <= delay_raddr_real_01;
                end
            end
            2'd2: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    virtual_dual_ram_02 <= virtual_dual_ram_din[11:0];
                    delay_raddr_real_02 <= virtual_dual_ram_waddr;
                end else begin
                    virtual_dual_ram_02 <= virtual_dual_ram_02;
                    delay_raddr_real_02 <= delay_raddr_real_02;
                end
            end
            2'd3: begin
                if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
                    virtual_dual_ram_03 <= virtual_dual_ram_din[11:0];
                    delay_raddr_real_03 <= virtual_dual_ram_waddr;
                end else begin
                    virtual_dual_ram_03 <= virtual_dual_ram_03;
                    delay_raddr_real_03 <= delay_raddr_real_03;
                end
            end
        endcase
    end

    // 3. Write virtual dual RAM
    reg  [3:0] virtual_dual_bram_data_flag = 4'b0000;
    always @(posedge clk) begin
        if (virtual_dual_ram_din_valid & ~virtual_dual_ram_din_valid_d1) begin
            case (delay_wr_state)
                2'd0: begin
                    virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag | 4'b0001;
                end
                2'd1: begin
                    virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag | 4'b0010;
                end
                2'd2: begin
                    virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag | 4'b0100;
                end
                2'd3: begin
                    virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag | 4'b1000;
                end
            endcase
        end else begin
            if (virtual_dual_ram_raddr == delay_raddr_real_00 && virtual_dual_bram_data_flag[0]) begin
                virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag & 4'b1110;
            end else if (virtual_dual_ram_raddr == delay_raddr_real_01 && virtual_dual_bram_data_flag[1]) begin
                virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag & 4'b1101;
            end else if (virtual_dual_ram_raddr == delay_raddr_real_02 && virtual_dual_bram_data_flag[2]) begin
                virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag & 4'b1011;
            end else if (virtual_dual_ram_raddr == delay_raddr_real_03 && virtual_dual_bram_data_flag[3]) begin
                virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag & 4'b0111;
            end else begin
                virtual_dual_bram_data_flag <= virtual_dual_bram_data_flag & 4'b1111;
            end
        end
    end

    // 3. Read virtual dual RAM
    always @(posedge clk) begin
        if (rst) begin
            virtual_dual_ram_dout       <= 12'd0;
            virtual_dual_ram_dout_valid <= 1'b0;
        end else if (virtual_dual_ram_raddr + 8'd1 == delay_raddr_real_00 && virtual_dual_bram_data_flag[0]) begin
            virtual_dual_ram_dout       <= virtual_dual_ram_00;
            virtual_dual_ram_dout_valid <= 1'b1;
        end else if (virtual_dual_ram_raddr + 8'd1 == delay_raddr_real_01 && virtual_dual_bram_data_flag[1]) begin
            virtual_dual_ram_dout       <= virtual_dual_ram_01;
            virtual_dual_ram_dout_valid <= 1'b1;
        end else if (virtual_dual_ram_raddr + 8'd1 == delay_raddr_real_02 && virtual_dual_bram_data_flag[2]) begin
            virtual_dual_ram_dout       <= virtual_dual_ram_02;
            virtual_dual_ram_dout_valid <= 1'b1;
        end else if (virtual_dual_ram_raddr + 8'd1 == delay_raddr_real_03 && virtual_dual_bram_data_flag[3]) begin
            virtual_dual_ram_dout       <= virtual_dual_ram_03;
            virtual_dual_ram_dout_valid <= 1'b1;
        end else begin
            virtual_dual_ram_dout       <= virtual_dual_ram_dout;
            virtual_dual_ram_dout_valid <= 1'b0;
        end
    end


endmodule
```
